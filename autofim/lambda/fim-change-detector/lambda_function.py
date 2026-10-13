# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# File Integrity Monitoring (FIM) change detector.
#
# Adapted from aws-samples/sample-inventory-monitor-fim with helpers.py
# inlined and `dateutil.parser.parse` replaced with
# `datetime.fromisoformat` so no Lambda layer / PyPI dependency is required.
# SSM Inventory ModificationTime values are ISO-8601 (e.g.
# "2024-01-01T12:00:00Z"); the trailing "Z" is normalized before parsing.

import json
import os
import re
from datetime import UTC, datetime
from urllib.parse import unquote_plus

import boto3

s3 = boto3.client("s3")
securityhub = boto3.client("securityhub")

CRITICAL_FILE_PATTERNS = os.environ["CRITICAL_FILE_PATTERNS"].split(",")
SEVERITY_LABEL = os.environ["SEVERITY_LABEL"]


def is_critical(path: str) -> bool:
    return any(
        re.match(p.strip(), path) for p in CRITICAL_FILE_PATTERNS if p.strip()
    )


def load_file_metadata(bucket: str, key: str, version_id: str) -> dict:
    """Return ``{path: (ModificationTime, Size)}`` for each AWS:File entry in
    the snapshot. Size is tracked alongside ModificationTime so that a file
    replaced/edited while its mtime is preserved (e.g. by a tool that
    restores the original timestamp after tampering) is detected as changed
    whenever the replacement content is a different length.

    Known limitation: the built-in SSM ``AWS:File`` inventory type only
    exposes metadata (name, size, dates) and does not include a content
    hash, so a same-size edit that also preserves mtime (a content-only
    tamper with no length change) cannot be distinguished from "unchanged"
    by this comparison alone. Detecting that case would require collecting
    a hash (e.g. sha256) via SSM custom inventory and comparing that
    instead of/in addition to Size.
    """
    obj = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    data = {}
    for line in obj["Body"].read().decode().splitlines():
        if line.strip():
            i = json.loads(line)
            n = i.get("Name", "").strip()
            d = i.get("InstalledDir", "").strip()
            m = i.get("ModificationTime", "").strip()
            sz = str(i.get("Size", "")).strip()
            if n and d and m:
                data[f"{d.rstrip('/')}/{n}"] = (m, sz)
    return data


def _parse_dt(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def is_modified(path: str, current: dict, previous: dict) -> bool:
    cur_mtime, cur_size = current[path]
    prev_mtime, prev_size = previous[path]
    # Size is compared as a plain string first (fast path, also catches
    # missing/empty values consistently); fall back to an exact mismatch if
    # either side doesn't parse as an int.
    #
    # NOTE: this only catches tamper-and-restore edits that also change the
    # file's length. A same-size content edit with a preserved mtime is
    # indistinguishable from "unchanged" using AWS:File metadata alone (no
    # content hash is available) and is a known, documented limitation -
    # see the module docstring on load_file_metadata and README gotcha #4.
    if cur_size != prev_size:
        return True
    try:
        return _parse_dt(cur_mtime) != _parse_dt(prev_mtime)
    except Exception:
        return cur_mtime != prev_mtime


def extract_instance_id(bucket: str, key: str, version_id: str) -> str | None:
    obj = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    for line in obj["Body"].read().decode().splitlines():
        if line.strip():
            r = json.loads(line)
            if "resourceId" in r:
                return r["resourceId"]
    return None


def process_record(record: dict, partition: str, region: str, account_id: str) -> None:
    """Diff a single S3 ObjectCreated record's current vs previous object
    version and, on a critical-file change, import a Security Hub
    finding. Raises on any unrecoverable error so the caller's retry /
    DLQ behavior is preserved per-record.
    """
    bucket = record["s3"]["bucket"]["name"]
    key = unquote_plus(record["s3"]["object"]["key"])
    current_version = record["s3"]["object"].get("versionId")
    if not current_version:
        return

    versions = s3.list_object_versions(Bucket=bucket, Prefix=key).get(
        "Versions", []
    )
    versions = sorted(versions, key=lambda v: v["LastModified"], reverse=True)

    idx = next(
        (i for i, v in enumerate(versions) if v["VersionId"] == current_version),
        None,
    )
    if idx is None or idx + 1 >= len(versions):
        return
    prev_version = versions[idx + 1]["VersionId"]

    current = load_file_metadata(bucket, key, current_version)
    previous = load_file_metadata(bucket, key, prev_version)

    created = {p for p in set(current) - set(previous) if is_critical(p)}
    deleted = {p for p in set(previous) - set(current) if is_critical(p)}
    modified = {
        p
        for p in set(current) & set(previous)
        if is_critical(p) and is_modified(p, current, previous)
    }

    if created or deleted or modified:
        instance_id = extract_instance_id(bucket, key, current_version)
        now = (
            datetime.now(UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        # Finding ID is deterministic from (instance, key, S3 versionId)
        # so S3-notification / async-Lambda retries (both at-least-once)
        # update the existing finding in Security Hub rather than creating
        # a duplicate.
        finding_id = f"fim-{instance_id}-{key}-{current_version}"
        finding = {
            "SchemaVersion": "2018-10-08",
            "Id": finding_id,
            "ProductArn": (
                f"arn:{partition}:securityhub:{region}:{account_id}"
                f":product/{account_id}/default"
            ),
            "AwsAccountId": account_id,
            "GeneratorId": "ssm-inventory-fim",
            "CreatedAt": now,
            "UpdatedAt": now,
            "Types": [
                "Software and Configuration Checks/File Integrity Monitoring"
            ],
            "Severity": {"Label": SEVERITY_LABEL},
            "Title": "File changes detected via SSM Inventory",
            "Description": (
                f"{len(created)} created, {len(modified)} modified, "
                f"{len(deleted)} deleted file(s) on instance {instance_id}"
            ),
            "Resources": [{"Type": "AwsEc2Instance", "Id": instance_id}],
        }
        # BatchImportFindings can return 200 OK with FailedCount > 0 when
        # individual findings are rejected (schema violation, throttling,
        # etc.). Discarding the response would make Lambda look successful
        # and skip retries / the DLQ. Raise so the async-invocation
        # retry policy engages and persistent failures land in the DLQ.
        response = securityhub.batch_import_findings(Findings=[finding])
        failed_count = response.get("FailedCount", 0)
        if failed_count:
            raise RuntimeError(
                f"Security Hub rejected {failed_count} finding(s): "
                f"{response.get('FailedFindings')}"
            )
    else:
        if prev_version != current_version:
            try:
                s3.delete_object(Bucket=bucket, Key=key, VersionId=prev_version)
            except Exception as e:
                print(f"Delete previous S3 object version failed: {e}")


def lambda_handler(event, context):
    if "Records" not in event or not event["Records"]:
        return

    # Derive partition + account from the invoked function ARN so this
    # handler works in aws-cn / aws-us-gov too, not just the commercial
    # partition. ARN format:
    #   arn:<partition>:lambda:<region>:<account>:function:<name>
    arn_parts = context.invoked_function_arn.split(":")
    partition = arn_parts[1]
    account_id = arn_parts[4]
    region = boto3.session.Session().region_name

    # An S3 Event Notification payload can batch multiple records into a
    # single Lambda invocation. Process every record rather than just
    # Records[0] so additional inventory snapshots delivered in the same
    # invocation are not silently acknowledged without comparison. Any
    # unhandled exception from an individual record propagates (instead
    # of being swallowed) so the async-invocation retry policy and DLQ
    # still engage for that failure.
    errors: list[Exception] = []
    for record in event["Records"]:
        try:
            process_record(record, partition, region, account_id)
        except Exception as e:  # noqa: BLE001 - re-raised below, not swallowed
            print(f"Failed to process record {record.get('s3', {})}: {e}")
            errors.append(e)
    if errors:
        raise errors[0]
