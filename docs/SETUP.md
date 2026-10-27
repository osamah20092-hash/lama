# Setup guide

## 1. Unity
- Install **Unity Hub** and **Unity 2022.3 LTS**.
- Add Android (and iOS if needed) **Build Support** modules.
- Open this folder with Unity Hub → the project generates `Library/` on first open.

## 2. Firebase
1. Create a project at <https://console.firebase.google.com>.
2. Add an **Android app** with your package id (e.g. `com.yourname.lamma`), download
   `google-services.json`, and place it in `Assets/`.
3. Enable **Authentication** → sign-in methods (Email/Password and/or Anonymous).
4. Enable **Realtime Database** (start in *locked* mode, then apply the rules below).
5. Import the **Firebase Unity SDK** (<https://firebase.google.com/download/unity>):
   `FirebaseAuth.unitypackage`, `FirebaseDatabase.unitypackage`, `FirebaseMessaging.unitypackage`.

### Realtime Database rules (starter — tighten before launch)
```json
{
  "rules": {
    "rooms": {
      ".read": "auth != null",
      "$roomId": {
        ".write": "auth != null",
        "members": { "$uid": { ".write": "auth.uid === $uid || data.parent().parent().child('ownerId').val() === auth.uid" } },
        "chat": { ".write": "auth != null" }
      }
    },
    "users": {
      "$uid": { ".read": "auth != null", ".write": "auth.uid === $uid" }
    }
  }
}
```

## 3. Agora (voice)
1. Create a project at <https://console.agora.io>, copy the **App ID**.
2. Enable **App Certificate** (for token auth) — recommended for production.
3. Import the **Agora Voice SDK for Unity** from the Asset Store or GitHub.
4. Run the token server (step 4) and put its URL + your App ID into `AppConfig`.

## 4. Agora token server
```bash
cd backend/agora-token-server
cp .env.example .env     # fill AGORA_APP_ID and AGORA_APP_CERTIFICATE
npm install
npm start                # serves GET /rtc/:channel/:uid  -> { token }
```
Deploy it free on Render / Railway / Cloud Run and use that URL in `AppConfig`.

## 5. Configure the app
- In Unity: `Assets/Resources/` → create an **AppConfig** asset
  (`Create ▸ Lamma ▸ App Config`) and fill:
  - `agoraAppId`
  - `tokenServerUrl` (e.g. `https://your-token-server/rtc`)
- Open the **Bootstrap** scene and press Play.

## 6. Build Android
- `File ▸ Build Settings ▸ Android`, set package id, and build.
- Minimum SDK 25+, ARM64, IL2CPP scripting backend.
