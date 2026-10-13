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
    obj = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    data = {}
    for line in obj["Body"].read().decode().splitlines():
        if line.strip():
            i = json.loads(line)
            n = i.get("Name", "").strip()
            d = i.get("InstalledDir", "").strip()
            m = i.get("ModificationTime", "").strip()
            if n and d and m:
                data[f"{d.rstrip('/')}/{n}"] = m
    return data


def _parse_dt(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def is_modified(path: str, current: dict, previous: dict) -> bool:
    try:
        return _parse_dt(current[path]) != _parse_dt(previous[path])
    except Exception:
        return current[path] != previous[path]


def extract_instance_id(bucket: str, key: str, version_id: str) -> str | None:
    obj = s3.get_object(Bucket=bucket, Key=key, VersionId=version_id)
    for line in obj["Body"].read().decode().splitlines():
        if line.strip():
            r = json.loads(line)
            if "resourceId" in r:
                return r["resourceId"]
    return None


def lambda_handler(event, context):
    if "Records" not in event or not event["Records"]:
        return

    record = event["Records"][0]
    bucket = record["s3"]["bucket"]["name"]
    key = unquote_plus(record["s3"]["object"]["key"])
    current_version = record["s3"]["object"].get("versionId")
    if not current_version:
        return

    account_id = context.invoked_function_arn.split(":")[4]
    region = boto3.session.Session().region_name

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
                f"arn:aws:securityhub:{region}:{account_id}"
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
