#!/usr/bin/env python3
"""Redact scanner output and write a report-only Markdown job summary.

Secret values are never written. Secret findings are recorded as file:line
and rule id only. The script replaces Semgrep and Trivy JSON/SARIF in place
with redacted copies and appends the summary to $GITHUB_STEP_SUMMARY when
that file is set.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN")
SECRET_HINTS = (
    "secret",
    "password",
    "passwd",
    "credential",
    "private-key",
    "private_key",
    "access-key",
    "access_key",
    "api-key",
    "api_key",
    "apikey",
    "auth-token",
    "hardcoded-token",
    "detected-aws",
    "detected-generic-api",
    "detected-jwt-token",
)
# Whole-line or token strings shorter than this are not treated as leak
# canaries; they collide with ordinary words in CVE text.
MIN_LEAK_LEN = 12
SUMMARY_TOP = 20


def load_json(path: Path):
    if not path.is_file() or path.stat().st_size == 0:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def rel_path(path: str) -> str:
    text = (path or "").replace("\\", "/").lstrip()
    workspace = os.environ.get("GITHUB_WORKSPACE", "").replace("\\", "/").rstrip("/")
    if workspace and text.startswith(workspace + "/"):
        text = text[len(workspace) + 1 :]
    for prefix in ("/src/", "./"):
        if text.startswith(prefix):
            text = text[len(prefix) :]
    return text or "(unknown)"


def norm_sev(value, fallback: str = "UNKNOWN") -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    text = str(value or "").strip().upper()
    aliases = {
        "ERROR": "HIGH",
        "WARNING": "MEDIUM",
        "WARN": "MEDIUM",
        "INFO": "LOW",
        "INFORMATIONAL": "LOW",
        "NOTE": "LOW",
    }
    text = aliases.get(text, text)
    if text not in SEVERITIES:
        return fallback
    return text


def is_secret_rule(rule_id: str, metadata: dict | None = None) -> bool:
    blob = (rule_id or "").lower()
    meta = metadata or {}
    parts = [blob, str(meta.get("category") or "").lower()]
    sub = meta.get("subcategory")
    if isinstance(sub, list):
        parts.extend(str(item).lower() for item in sub)
    elif sub:
        parts.append(str(sub).lower())
    haystack = " ".join(parts)
    return any(hint in haystack for hint in SECRET_HINTS)


def remember_leak(leaks: list[str], value) -> None:
    if not isinstance(value, str):
        return
    text = value.strip()
    if len(text) >= MIN_LEAK_LEN:
        leaks.append(text)


def semgrep_key_type(rule_id: str) -> str:
    tail = (rule_id or "secret").split(".")[-1].replace("_", "-")
    for prefix in ("detected-", "detect-"):
        if tail.startswith(prefix):
            tail = tail[len(prefix) :]
    tail = tail.removesuffix("-value").replace("-", " ").strip()
    return tail or "secret"


def scrub_semgrep(data, leaks: list[str]):
    findings = []
    if not isinstance(data, dict):
        return data, findings
    results = data.get("results")
    if not isinstance(results, list):
        return data, findings
    for result in results:
        if not isinstance(result, dict):
            continue
        extra = result.get("extra") if isinstance(result.get("extra"), dict) else {}
        rule_id = str(result.get("check_id") or "")
        metadata = extra.get("metadata") if isinstance(extra.get("metadata"), dict) else {}
        secret = is_secret_rule(rule_id, metadata)
        path = rel_path(str(result.get("path") or ""))
        start = result.get("start") if isinstance(result.get("start"), dict) else {}
        line = start.get("line")
        severity = norm_sev(metadata.get("severity") or extra.get("severity"), "UNKNOWN")
        message = str(extra.get("message") or "").replace("\n", " ").strip()
        if secret:
            remember_leak(leaks, extra.get("message"))
            remember_leak(leaks, extra.get("lines"))
            metavars = extra.get("metavars") if isinstance(extra.get("metavars"), dict) else {}
            for spec in metavars.values():
                if isinstance(spec, dict):
                    remember_leak(leaks, spec.get("abstract_content"))
                    remember_leak(leaks, spec.get("propagated_value"))
            extra.pop("lines", None)
            extra.pop("fixed_lines", None)
            extra.pop("metavars", None)
            extra.pop("dataflow_trace", None)
            extra["message"] = "Secret finding redacted."
            result["extra"] = extra
            findings.append(
                {
                    "tool": "semgrep",
                    "kind": "secret",
                    "secret": True,
                    "severity": severity,
                    "path": path,
                    "line": line,
                    "rule": rule_id,
                    "key_type": semgrep_key_type(rule_id),
                }
            )
        else:
            findings.append(
                {
                    "tool": "semgrep",
                    "kind": "sast",
                    "secret": False,
                    "severity": severity,
                    "path": path,
                    "line": line,
                    "rule": rule_id,
                    "message": message[:300],
                }
            )
    # Engine errors can echo source. Keep the type and path only.
    errors = data.get("errors")
    if isinstance(errors, list):
        slim = []
        for err in errors:
            if isinstance(err, dict):
                slim.append(
                    {
                        "type": err.get("type") or err.get("code"),
                        "path": rel_path(str(err.get("path") or "")),
                    }
                )
            else:
                slim.append({"type": "error"})
        data["errors"] = slim
    return data, findings


def scrub_trivy(data, leaks: list[str]):
    findings = []
    secret_rules: set[str] = set()
    if not isinstance(data, dict):
        return data, findings, secret_rules
    results = data.get("Results")
    if not isinstance(results, list):
        return data, findings, secret_rules
    for result in results:
        if not isinstance(result, dict):
            continue
        target = rel_path(str(result.get("Target") or ""))
        for vuln in result.get("Vulnerabilities") or []:
            if not isinstance(vuln, dict):
                continue
            findings.append(
                {
                    "tool": "trivy",
                    "kind": "vuln",
                    "secret": False,
                    "severity": norm_sev(vuln.get("Severity")),
                    "path": target,
                    "line": None,
                    "rule": str(vuln.get("VulnerabilityID") or ""),
                    "message": one_line(vuln.get("Title") or vuln.get("Description") or ""),
                    "package": vuln.get("PkgName"),
                    "installed": vuln.get("InstalledVersion"),
                    "fixed": vuln.get("FixedVersion"),
                }
            )
        for secret in result.get("Secrets") or []:
            if not isinstance(secret, dict):
                continue
            rule_id = str(secret.get("RuleID") or "")
            secret_rules.add(rule_id)
            remember_leak(leaks, secret.get("Match"))
            code = secret.get("Code")
            if isinstance(code, dict):
                for code_line in code.get("Lines") or []:
                    if isinstance(code_line, dict):
                        remember_leak(leaks, code_line.get("Content"))
            secret.pop("Match", None)
            secret.pop("Code", None)
            title = str(secret.get("Title") or secret.get("Category") or rule_id)
            findings.append(
                {
                    "tool": "trivy",
                    "kind": "secret",
                    "secret": True,
                    "severity": norm_sev(secret.get("Severity"), "HIGH"),
                    "path": target,
                    "line": secret.get("StartLine"),
                    "rule": rule_id,
                    "key_type": title,
                }
            )
        for misconf in result.get("Misconfigurations") or []:
            if not isinstance(misconf, dict):
                continue
            cause = misconf.get("CauseMetadata") if isinstance(misconf.get("CauseMetadata"), dict) else {}
            line = cause.get("StartLine")
            findings.append(
                {
                    "tool": "trivy",
                    "kind": "misconfig",
                    "secret": False,
                    "severity": norm_sev(misconf.get("Severity")),
                    "path": target,
                    "line": line,
                    "rule": str(misconf.get("ID") or misconf.get("AVDID") or ""),
                    "message": one_line(misconf.get("Title") or misconf.get("Description") or ""),
                }
            )
            # Misconfig snippets can repeat a secret line. Drop the code block.
            cause.pop("Code", None)
            misconf.pop("CauseMetadata", None)
            if cause:
                cause.pop("Code", None)
                misconf["CauseMetadata"] = {
                    "StartLine": cause.get("StartLine"),
                    "EndLine": cause.get("EndLine"),
                    "Provider": cause.get("Provider"),
                    "Service": cause.get("Service"),
                }
    return data, findings, secret_rules


def scrub_sarif(data, secret_rules: set[str]):
    if not isinstance(data, dict):
        return data
    for run in data.get("runs") or []:
        if not isinstance(run, dict):
            continue
        for result in run.get("results") or []:
            if not isinstance(result, dict):
                continue
            rule_id = str(result.get("ruleId") or "")
            if rule_id not in secret_rules and not is_secret_rule(rule_id):
                continue
            result["message"] = {"text": "Secret finding redacted."}
            for location in result.get("locations") or []:
                if not isinstance(location, dict):
                    continue
                physical = location.get("physicalLocation")
                if not isinstance(physical, dict):
                    continue
                region = physical.get("region")
                if isinstance(region, dict):
                    region.pop("snippet", None)
                physical.pop("contextRegion", None)
            result.pop("codeFlows", None)
            result.pop("attachments", None)
            props = result.get("properties")
            if isinstance(props, dict):
                for key in list(props):
                    if key.lower() in {"lines", "line", "match", "snippet", "code"}:
                        props.pop(key, None)
    return data


def one_line(value) -> str:
    return " ".join(str(value or "").split())[:300]


def md_cell(value) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def location(finding: dict) -> str:
    path = finding.get("path") or "(unknown)"
    line = finding.get("line")
    if isinstance(line, int) and line > 0:
        return f"{path}:{line}"
    return path


def counts_table(counter: Counter) -> str:
    lines = ["| Severity | Count |", "| --- | ---: |"]
    for severity in SEVERITIES:
        lines.append(f"| {severity} | {counter.get(severity, 0)} |")
    lines.append(f"| Total | {sum(counter.values())} |")
    return "\n".join(lines)


def format_finding(finding: dict) -> str:
    loc = location(finding)
    rule = finding.get("rule") or "(no rule)"
    severity = finding.get("severity") or "UNKNOWN"
    tool = finding.get("tool") or "scanner"
    kind = finding.get("kind") or "finding"
    if finding.get("secret"):
        return f"- {tool} {severity} secret `{loc}` `{rule}`"
    message = md_cell(finding.get("message") or "")
    extra = ""
    if finding.get("package"):
        fixed = finding.get("fixed") or "no fix version"
        extra = f" ({finding.get('package')} {finding.get('installed')} → {fixed})"
    detail = f" — {message}{extra}" if message or extra else ""
    return f"- {tool} {severity} {kind} `{loc}` `{rule}`{detail}"


def code_scanning_note(root: Path) -> str:
    status_path = root / "code-scanning-status.txt"
    raw = ""
    if status_path.is_file():
        raw = status_path.read_text(encoding="utf-8", errors="replace")[:800]
    first = raw.splitlines()[0].strip().lower() if raw.strip() else ""
    if first == "available":
        return (
            "The code scanning API accepted a query for this repository. "
            "This workflow's token is limited to `contents: read`, so results "
            "are still uploaded as the `security-reports` artifact rather than "
            "sent to code scanning."
        )
    message = "Code scanning is not enabled for this repository."
    matched = re.search(r'"message"\s*:\s*"([^"]+)"', raw)
    if matched:
        message = matched.group(1).rstrip(".").strip()[:240]
    elif raw.strip():
        for line in raw.splitlines():
            if "code scanning" in line.lower() and not line.lower().startswith("unavailable"):
                message = line.strip()[:240]
                break
    return (
        "Code scanning is not available for this private personal repository, "
        "so SARIF and JSON are uploaded as the `security-reports` workflow "
        f"artifact. GitHub API: {message}."
    )


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def withhold(root: Path, summary_path: Path | None, reason: str) -> str:
    for name in (
        "semgrep.json",
        "semgrep.sarif",
        "trivy.json",
        "trivy.sarif",
        "security-findings.json",
        "security-summary.md",
    ):
        try:
            (root / name).unlink(missing_ok=True)
        except OSError:
            pass
    text = (
        "# Security scan (report-only)\n\n"
        "Reports were withheld because a secret value would have been written "
        f"into the output. {reason}\n"
    )
    if summary_path is not None:
        with summary_path.open("a", encoding="utf-8") as handle:
            handle.write(text)
    (root / "security-summary.md").write_text(text, encoding="utf-8")
    return text


def build_summary(root: Path, findings: list[dict], notes: list[str]) -> str:
    by_tool: dict[str, list[dict]] = {"semgrep": [], "trivy": []}
    for finding in findings:
        by_tool.setdefault(finding["tool"], []).append(finding)
    overall = Counter(finding["severity"] for finding in findings)
    ranked = sorted(
        findings,
        key=lambda item: (
            SEVERITIES.index(item["severity"]) if item["severity"] in SEVERITIES else 99,
            item["path"],
            item.get("line") or 0,
            item["rule"],
        ),
    )
    critical_high = [item for item in ranked if item["severity"] in {"CRITICAL", "HIGH"}]
    secrets = [item for item in ranked if item.get("secret")]
    lines = [
        "# Security scan (report-only)",
        "",
        "Findings do not fail this job. Secret values are omitted.",
        "",
        code_scanning_note(root),
        "",
        "## Counts by severity",
        "",
        counts_table(overall),
        "",
    ]
    if notes:
        lines.extend(["## Scanner status", ""])
        lines.extend(f"- {note}" for note in notes)
        lines.append("")
    lines.extend(["## Top critical and high findings", ""])
    if not critical_high:
        lines.append("No critical or high findings.")
    else:
        shown = critical_high[:SUMMARY_TOP]
        lines.extend(format_finding(item) for item in shown)
        remaining = len(critical_high) - len(shown)
        if remaining:
            lines.append(f"- {remaining} more critical/high findings are in `security-findings.json`.")
    lines.extend(["", "## Secrets", ""])
    if not secrets:
        lines.append("No secret findings.")
    else:
        lines.append("File, line, and rule only.")
        lines.append("")
        for item in secrets:
            lines.append(f"- `{location(item)}` `{item.get('rule') or '(no rule)'}`")
    lines.append("")
    for tool, label in (("semgrep", "Semgrep OSS"), ("trivy", "Trivy")):
        tool_findings = by_tool.get(tool, [])
        lines.extend([f"## {label}", "", counts_table(Counter(item["severity"] for item in tool_findings)), ""])
    return "\n".join(lines).rstrip() + "\n"


def outputs_contain_leak(root: Path, summary: str, leaks: list[str]) -> bool:
    names = (
        "semgrep.json",
        "semgrep.sarif",
        "trivy.json",
        "trivy.sarif",
        "security-findings.json",
        "security-summary.md",
    )
    blob = summary
    for name in names:
        path = root / name
        if path.is_file():
            blob += path.read_text(encoding="utf-8", errors="replace")
    return any(leak in blob for leak in leaks)


def main() -> int:
    root = Path(os.environ.get("SECURITY_REPORT_DIR", ".")).resolve()
    summary_env = os.environ.get("GITHUB_STEP_SUMMARY")
    summary_path = Path(summary_env) if summary_env else None
    leaks: list[str] = []
    notes: list[str] = []

    semgrep_exit = os.environ.get("SEMGREP_EXIT", "")
    trivy_outcome = os.environ.get("TRIVY_JSON_OUTCOME", "")
    trivy_sarif_outcome = os.environ.get("TRIVY_SARIF_OUTCOME", "")
    if semgrep_exit:
        notes.append(f"Semgrep exit code: {semgrep_exit} (findings do not fail the job).")
    if trivy_outcome:
        notes.append(f"Trivy JSON step: {trivy_outcome}.")
    if trivy_sarif_outcome:
        notes.append(f"Trivy SARIF step: {trivy_sarif_outcome}.")

    semgrep_path = root / "semgrep.json"
    semgrep_sarif_path = root / "semgrep.sarif"
    trivy_path = root / "trivy.json"
    trivy_sarif_path = root / "trivy.sarif"

    semgrep_data = load_json(semgrep_path)
    trivy_data = load_json(trivy_path)
    semgrep_sarif = load_json(semgrep_sarif_path)
    trivy_sarif = load_json(trivy_sarif_path)

    if semgrep_data is None:
        notes.append("Semgrep JSON was missing or unreadable.")
    if trivy_data is None:
        notes.append("Trivy JSON was missing or unreadable.")

    findings: list[dict] = []
    secret_rules: set[str] = set()
    if semgrep_data is not None:
        semgrep_data, semgrep_findings = scrub_semgrep(semgrep_data, leaks)
        findings.extend(semgrep_findings)
        secret_rules.update(item["rule"] for item in semgrep_findings if item.get("secret"))
        write_json(semgrep_path, semgrep_data)
    if isinstance(semgrep_sarif, dict):
        write_json(semgrep_sarif_path, scrub_sarif(semgrep_sarif, secret_rules))
    elif semgrep_sarif_path.is_file():
        notes.append("Semgrep SARIF was unreadable and was removed.")
        semgrep_sarif_path.unlink(missing_ok=True)

    if trivy_data is not None:
        trivy_data, trivy_findings, trivy_secret_rules = scrub_trivy(trivy_data, leaks)
        findings.extend(trivy_findings)
        secret_rules.update(trivy_secret_rules)
        write_json(trivy_path, trivy_data)
    if isinstance(trivy_sarif, dict):
        write_json(trivy_sarif_path, scrub_sarif(trivy_sarif, secret_rules))
    elif trivy_sarif_path.is_file():
        notes.append("Trivy SARIF was unreadable and was removed.")
        trivy_sarif_path.unlink(missing_ok=True)

    # Drop exact duplicates so overlapping Semgrep packs do not double-count.
    unique = []
    seen = set()
    for finding in findings:
        key = (
            finding["tool"],
            finding["kind"],
            finding["severity"],
            finding["path"],
            finding.get("line"),
            finding["rule"],
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(finding)
    findings = unique

    critical_high = [item for item in findings if item["severity"] in {"CRITICAL", "HIGH"}]
    secrets = [item for item in findings if item.get("secret")]
    report = {
        "counts": {severity: sum(1 for item in findings if item["severity"] == severity) for severity in SEVERITIES},
        "critical_high": critical_high,
        "secrets": secrets,
    }
    write_json(root / "security-findings.json", report)
    summary = build_summary(root, findings, notes)
    (root / "security-summary.md").write_text(summary, encoding="utf-8")

    if outputs_contain_leak(root, summary, leaks):
        withhold(root, summary_path, "The redaction check found a secret string in the report.")
        return 0

    if summary_path is not None:
        with summary_path.open("a", encoding="utf-8") as handle:
            handle.write(summary)
    return 0


def self_test() -> int:
    canary = "CANARYSECRETVALUE_abc123XYZ"
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        semgrep = {
            "results": [
                {
                    "check_id": "generic.secrets.security.detected-generic-api-key",
                    "path": "src/example.ts",
                    "start": {"line": 9},
                    "extra": {
                        "message": f"found {canary}",
                        "severity": "ERROR",
                        "lines": f"const key = '{canary}'",
                        "metavars": {"$K": {"abstract_content": canary}},
                        "metadata": {"severity": "CRITICAL", "category": "security"},
                    },
                },
                {
                    "check_id": "javascript.lang.security.detect-eval-with-expression.detect-eval-with-expression",
                    "path": "src/app.js",
                    "start": {"line": 4},
                    "extra": {
                        "message": "eval() executes a string as code.",
                        "severity": "WARNING",
                        "metadata": {"severity": "HIGH"},
                        "lines": "eval(input)",
                    },
                },
            ]
        }
        trivy = {
            "Results": [
                {
                    "Target": "package-lock.json",
                    "Vulnerabilities": [
                        {
                            "VulnerabilityID": "CVE-2026-0001",
                            "PkgName": "example",
                            "InstalledVersion": "1.0.0",
                            "FixedVersion": "1.2.0",
                            "Severity": "HIGH",
                            "Title": "Example library prototype pollution",
                        }
                    ],
                    "Secrets": [
                        {
                            "RuleID": "github-pat",
                            "Category": "GitHub",
                            "Severity": "CRITICAL",
                            "Title": "GitHub Personal Access Token",
                            "StartLine": 12,
                            "Match": canary,
                            "Code": {"Lines": [{"Number": 12, "Content": f"token={canary}", "IsCause": True}]},
                        }
                    ],
                }
            ]
        }
        sarif = {
            "runs": [
                {
                    "results": [
                        {
                            "ruleId": "github-pat",
                            "level": "error",
                            "message": {"text": canary},
                            "locations": [
                                {
                                    "physicalLocation": {
                                        "artifactLocation": {"uri": "wrangler.toml"},
                                        "region": {"startLine": 12, "snippet": {"text": canary}},
                                    }
                                }
                            ],
                        }
                    ]
                }
            ]
        }
        (root / "semgrep.json").write_text(json.dumps(semgrep), encoding="utf-8")
        (root / "trivy.json").write_text(json.dumps(trivy), encoding="utf-8")
        (root / "semgrep.sarif").write_text(json.dumps({"runs": []}), encoding="utf-8")
        (root / "trivy.sarif").write_text(json.dumps(sarif), encoding="utf-8")
        (root / "code-scanning-status.txt").write_text(
            "unavailable: Code scanning is not enabled for this repository.\n",
            encoding="utf-8",
        )
        env = os.environ.copy()
        env["SECURITY_REPORT_DIR"] = str(root)
        env.pop("GITHUB_STEP_SUMMARY", None)
        # Re-enter main against the fixture directory.
        os.environ["SECURITY_REPORT_DIR"] = str(root)
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        code = main()
        blob = ""
        for path in root.iterdir():
            blob += path.read_text(encoding="utf-8", errors="replace")
        if canary in blob:
            print("self-test failed: canary leaked", file=sys.stderr)
            return 1
        summary = (root / "security-summary.md").read_text(encoding="utf-8")
        for expected in ("src/example.ts:9", "github-pat", "CVE-2026-0001", "src/app.js:4"):
            if expected not in summary and expected not in blob:
                print(f"self-test failed: missing {expected}", file=sys.stderr)
                return 1
        if "eval() executes a string as code." not in summary:
            print("self-test failed: non-secret message missing", file=sys.stderr)
            return 1
        if code != 0:
            print(f"self-test failed: exit {code}", file=sys.stderr)
            return 1
    print("self-test ok")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        raise SystemExit(self_test())
    raise SystemExit(main())
