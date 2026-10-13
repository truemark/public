# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
#
# Unit tests for the FIM change-detector Lambda's diff logic. Run with:
#   python3 -m venv .venv && source .venv/bin/activate
#   pip install boto3 pytest
#   pytest autofim/lambda/fim-change-detector/test_lambda_function.py
#
# boto3 is only imported (not called) by lambda_function at module load
# time, so these tests don't need real AWS credentials or moto.

import os

os.environ.setdefault("CRITICAL_FILE_PATTERNS", r"^/etc/paymentapp/config.*$")
os.environ.setdefault("SEVERITY_LABEL", "MEDIUM")

import lambda_function as lf  # noqa: E402


def test_is_modified_detects_mtime_change():
    current = {"/etc/paymentapp/config.yaml": ("2024-01-02T00:00:00Z", "100")}
    previous = {"/etc/paymentapp/config.yaml": ("2024-01-01T00:00:00Z", "100")}
    assert lf.is_modified("/etc/paymentapp/config.yaml", current, previous)


def test_is_modified_detects_size_change_with_identical_mtime():
    # Regression test: a file replaced/edited while its ModificationTime is
    # preserved (e.g. by a tool that restores the original timestamp after
    # tampering) must still be classified as modified. Comparing
    # ModificationTime alone would be a false negative here.
    path = "/etc/paymentapp/config.yaml"
    current = {path: ("2024-01-01T00:00:00Z", "250")}
    previous = {path: ("2024-01-01T00:00:00Z", "100")}
    assert lf.is_modified(path, current, previous)


def test_is_modified_false_when_mtime_and_size_unchanged():
    path = "/etc/paymentapp/config.yaml"
    current = {path: ("2024-01-01T00:00:00Z", "100")}
    previous = {path: ("2024-01-01T00:00:00Z", "100")}
    assert not lf.is_modified(path, current, previous)


def test_is_modified_falls_back_to_string_compare_on_bad_timestamp():
    path = "/etc/paymentapp/config.yaml"
    current = {path: ("not-a-timestamp", "100")}
    previous = {path: ("not-a-timestamp", "100")}
    assert not lf.is_modified(path, current, previous)

    previous_changed = {path: ("also-not-a-timestamp", "100")}
    assert lf.is_modified(path, current, previous_changed)


def test_is_critical_matches_configured_pattern():
    assert lf.is_critical("/etc/paymentapp/config.yaml")
    assert not lf.is_critical("/etc/paymentapp/readme.txt")
