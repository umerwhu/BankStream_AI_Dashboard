BankStream backend logging
==========================

The shared Winston logger is `src/utils/logger.js`. Import this instance rather
than adding transports or process listeners in request handlers.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| LOG_LEVEL | info | debug, info, warn, error |
| LOG_FORMAT | legacy setting | Output is consistently human-readable in console and files |
| LOG_DIR | ./logs | Resolved against the working directory |
| LOG_RETENTION_DAYS | 14 | Remove expired files on startup and rotation |
| LOG_MAX_SIZE | 10m | Rotation threshold per file |
| LOG_MAX_FILES | 100 | Maximum retained files per stream, including active file |

Files use `logs/archived/application-YYYY-MM-DD.log` and
`logs/archived/error-YYYY-MM-DD.log`, with numbered suffixes on size rotation.
This avoids symlink privileges on Windows. Application files contain INFO and
above; error files contain only ERROR. Retention and file-count limits both
apply, bounding storage to approximately 2 × LOG_MAX_FILES × LOG_MAX_SIZE plus
the final entry and transport metadata. Retention cleanup runs when logging is
active, rather than through a separate scheduled job. `logs/` and `*.log` are
already ignored by Git. Run `npm run logs` to inspect recent service log files.
The service launcher no longer creates unbounded duplicate stdout/stderr files;
older files in `var/logs` are left intact.

Every new entry starts with an ISO UTC timestamp, event, level, environment, PID, request ID,
method, endpoint, status and durationMs. Inapplicable values are null. Request IDs
are server-generated UUIDs, returned in X-Request-ID and propagated to downstream
logs through AsyncLocalStorage without modifying upstream HTTP headers.

Successful dashboard poll requests and their downstream calls use DEBUG;
other successful API calls use INFO. Failures remain visible at WARN/ERROR.
`startedAt` records execution start; monotonic clocks measure durations. HTTP
duration includes response completion; downstream duration measures fetch through
receipt of response headers, preserving existing response/body processing.
Each retry attempt records its status or network/timeout failure and whether the
existing retry loop will retry. Retry counts, delays and timeouts are unchanged.

Enable LOG_LEVEL=debug for polling diagnostics. Skipped overlapping refreshes are
reported through browser console.debug at the existing in-flight guard. Their
timestamps reflect browser execution. They cannot reach the backend because the
guard prevents the request. Poll intervals, scheduling and UI behavior are unchanged.

Security: no request/response bodies, headers or query values are serialized.
Incoming paths use Express route templates to omit customer and record IDs.
Unknown routes use `/api/[unmatched]`. Downstream calls use configured published
route names, never raw URLs. OAuth and legacy banking endpoints use fixed labels.
Error details contain a safe type/code and stack frames with locations removed;
raw error messages and cause objects are deliberately excluded because they can
contain credentials, SQL or customer records. Pass only operational metadata to
the logger; never pass application payloads or customer data.

Startup investigation: server.js had one listen call and a once('listening')
handler. The legacy service appended identical lines across runs without dates or
PIDs. No running `server.js` dashboard instance was present during inspection.
There is no confirmed duplicate startup defect; historical lines cannot establish
their original cause. New application.start, shutdown, listen-error and process
error events make future diagnosis possible without changing server binding.
Graceful shutdown drains HTTP requests and logs, with a ten-second deadline.

Example output (illustrative):

```text
2026-10-28T09:49:00.000Z INFO: Downstream API response received | API: TapData | GET /api/v1/MDM_CUSTOMER360 | Status: 200 | Duration: 125ms | RequestID: 9bf0cb7c-85bb-4773-b569-412c2969464a | Event: upstream.complete | Success: true | Environment: production | Pid: 1234
```

Console and file transports share the same formatter. Existing log contents are left
intact; new entries use the readable format.

Validation: `npm test` includes logging checks for UTC serialization, file routing,
size rotation, retention, bounded file counts, HTTP request correlation, sanitized
routes/errors, elapsed time, timeout/retry metadata and single polling failure
completion. Existing refresh and TapData tests continue to exercise unchanged
polling and adapter behavior.
