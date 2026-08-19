# Production identity and release setup

## Google Sign-In

1. In Google Cloud, configure the OAuth consent screen and create an Android OAuth client for package `com.nazraa.live` with the SHA-1 of the production signing certificate.
2. Create a Web OAuth client. Pass that client ID to Flutter as `--dart-define=GOOGLE_WEB_CLIENT_ID=...`.
3. Set the same client ID in the server-only `GOOGLE_OAUTH_CLIENT_IDS` environment variable. Multiple accepted audiences may be comma-separated.
4. Deploy the control platform, build with the production keystore, and test a new account plus a returning account on a physical Android device.

The server verifies the token signature, issuer, audience, expiry, subject, and verified-email claim through Google's maintained authentication library before creating a Nazraa session.

## Face verification

The private-beta flow captures one fresh selfie and approves it automatically
on the server. The raw capture is not retained. The existing provider contract
below remains available if production later re-enables enhanced biometric
checks.

### Optional biometric provider contract

Configure three server-only values:

- `FACE_BIOMETRIC_PROVIDER_URL`: an HTTPS endpoint.
- `FACE_BIOMETRIC_PROVIDER_SECRET`: a bearer secret of at least 24 characters.
- `FACE_BIOMETRIC_PROVIDER_NAME`: the label written to verification history.

Nazraa sends a JSON `POST` containing `subjectId`, `consentVersion`, two to four base64 JPEG `frames`, and `checks` with `liveness`, `duplicateSearch`, and `singleFace` set to `true`.

The endpoint must return:

```json
{
  "livenessPassed": true,
  "livenessScore": 0.99,
  "duplicateSubjectId": null,
  "matchScore": null,
  "providerFaceId": "provider-reference",
  "embeddingReference": "provider-encrypted-reference",
  "retainReferenceImage": false
}
```

`providerFaceId` and `embeddingReference` are required opaque references; Nazraa does not store the submitted frames. A failed liveness result becomes `RETRY`; a match to another subject becomes `DUPLICATE`; unconfigured, timed-out, non-HTTPS, or invalid provider responses fail closed. The provider must encrypt biometric templates, restrict operator access, enforce deletion/retention policy, and return a different subject only when its production duplicate-search threshold is met.

## Android release key

The permanent local upload identity is stored outside source control at:

```text
~/.nazraa/android-release/nazraa-release-upload.jks
```

Its password is stored in the macOS login Keychain under account
`nazraa-release` and service `Nazraa Android Release Signing`. The ignored
`android/key.properties` symlink contains only the keystore path, alias, and
Keychain lookup labels. Gradle loads the password automatically without putting
it in source, build logs, or command arguments.

The equivalent CI variables remain `NAZRAA_KEYSTORE_FILE`,
`NAZRAA_KEYSTORE_PASSWORD`, `NAZRAA_KEY_ALIAS`, and `NAZRAA_KEY_PASSWORD`.
Release tasks stop with an error if neither the local Keychain identity nor
these CI values are available; they never fall back to the debug certificate.

Build only after Google, biometric, API, database, ZEGOCLOUD Token04, and signing settings are deployed:

```sh
./scripts/build_android.sh release --dart-define=GOOGLE_WEB_CLIENT_ID=YOUR_WEB_CLIENT_ID
```
