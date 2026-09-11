# JARVIS V15.0.1 — Creator Identity & Documentation

V15.0.1 refines the V15 superior layer with application-level creator identity instead of a pile of brittle name-specific replies.

## Creator identity

JARVIS derives its creator identity from the configured owner identity:

- `JARVIS_OWNER_ID` — authoritative Discord user ID.
- `JARVIS_OWNER_NAME` — display name used in JARVIS responses.
- `JARVIS_OWNER_TAG` — display tag/mention label.

The Discord ID is the verification source. Names are presentation data and can change.

## Behavior

When anyone asks who made, created, built, or owns JARVIS, the answer is based on the configured creator identity. It does not substitute fictional characters or celebrities.

For ordinary non-master requests, the existing roast behavior remains unchanged.

## V15.0 features retained

- Command preview / dry-run planning.
- Action history.
- Snapshot diff reporting.
- Incident reports.
- Case explanations.
- Member profiles.
- Server health scoring.
- Watch mode.
- Scheduled JARVIS actions.
- Existing V9/V11/V12/V13/V14/V14.5 systems.

## Documentation layout

Historical version READMEs and patch notes are organized under `docs/releases/`.
