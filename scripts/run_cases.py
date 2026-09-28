#!/usr/bin/env python3
"""Structural validation for every evals/cases.json in this skill pack."""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    files = sorted(root.rglob("evals/cases.json"))
    skills: set[str] = set()
    seen_ids: dict[str, Path] = {}
    total = 0
    valid = 0
    errors: list[str] = []

    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path.relative_to(root)}: cannot read JSON: {exc}")
            continue

        skill = payload.get("skill")
        cases = payload.get("cases")
        if isinstance(skill, str) and skill:
            skills.add(skill)
        if not isinstance(cases, list):
            errors.append(f"{path.relative_to(root)}: 'cases' must be a list")
            continue

        for index, case in enumerate(cases, start=1):
            total += 1
            label = f"{path.relative_to(root)} case #{index}"
            if not isinstance(case, dict):
                errors.append(f"{label}: case must be an object")
                continue

            case_id = case.get("id")
            case_type = case.get("type")
            # Older pack cases use scenario/pass_if/fail_if; new cases use the
            # requested prompt/expect_pass/expect_fail schema.
            prompt = case.get("prompt") or case.get("scenario")
            expect_pass = case.get("expect_pass", case.get("pass_if"))
            expect_fail = case.get("expect_fail", case.get("fail_if"))
            problems = []
            if not isinstance(case_id, str) or not case_id.strip():
                problems.append("id must be a non-empty string")
            if not isinstance(case_type, str) or not case_type.strip():
                problems.append("type must be a non-empty string")
            if not isinstance(prompt, str) or not prompt.strip():
                problems.append("prompt/scenario must be a non-empty string")
            if not isinstance(expect_pass, list):
                problems.append("expect_pass/pass_if must be a list")
            if not isinstance(expect_fail, list):
                problems.append("expect_fail/fail_if must be a list")

            if isinstance(case_id, str) and case_id.strip():
                if case_id in seen_ids:
                    problems.append(
                        f"duplicate id also in {seen_ids[case_id].relative_to(root)}"
                    )
                else:
                    seen_ids[case_id] = path

            if problems:
                errors.append(f"{label}: " + "; ".join(problems))
            else:
                valid += 1

    print(f"Skills scanned: {len(skills)}")
    print(f"Total cases: {total}")
    print(f"Cases with valid structure: {valid}")
    print(f"Invalid cases: {total - valid}")
    if errors:
        for error in errors:
            print(f"FAIL: {error}")
        return 1
    print("Result: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
