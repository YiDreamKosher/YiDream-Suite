# Official Zemer updates

The shared catalogue publishes the official stable Zemer release for every paired
device. MP3 and Qin already include `com.jtech.zemer` in their default app lists;
no application exception or device permission is added by this migration. A
device-specific app denial remains authoritative.

An update remains available in YiDream's settings when the app-store section is
hidden. The Android catalogue screen only offers updates for apps installed on
the device. A first installation still requires an explicit per-device app grant.
Downloading catalogue metadata does not grant app access.

## Verified release

Verified on 2026-11-19 from the [official website](https://zemer.io/) and its linked
[ZemerTeam repository](https://github.com/ZemerTeam/zemer-app):

| Field | Value |
| --- | --- |
| Stable release | [v41](https://github.com/ZemerTeam/zemer-app/releases/tag/v41) |
| APK | [Official release asset](https://github.com/ZemerTeam/zemer-app/releases/download/v41/app-release.apk) |
| Package | `com.jtech.zemer` |
| Version code / name | `41` / `41` |
| Minimum Android API | `26` (Android 8) |
| Debuggable | `false` |
| APK SHA-256 | `fdf0115f6ace608119c7dd57db62666d59ea8f8beb6465119848b9bd6d0a6edd` |
| Signing certificate SHA-256 | `89cd74c05a2bf5d50e742614926d5e5d015b9b344d8576963f130310347b10f5` |

The downloaded APK's hash matches GitHub's release-asset digest. Google's
`com.android.tools.build:apksig:8.13.2` verified the APK signature with no errors
or warnings; its binary manifest confirmed the package and version above.
The Android installer still validates the checksum, exact package, increasing
version, current device approval and compatibility with the installed signing
certificate before installation.

The catalogue has no icon field. YiDream uses the actual installed application's
icon, avoiding a separate unverified image source.

## Publication and later releases

Apply `20261119150527_zemer_verified_update_catalog.sql` after the existing
catalogue and device-policy migrations. It inserts a base release owned by the
active platform owner and changes no device rules, grants, RPCs, storage access,
or unknown-source install restrictions. It does not replace a later edited or
disabled publication on rerun. An unexpected private/other-owner base
publication fails with `ZEMER_CATALOG_CONFLICT` for owner review.

There is no automatic promotion of nightly or future releases. Verify the next
stable APK's identity, signature, version and digest before updating its owner
publication. The exact version URL and checksum stay pinned together.
