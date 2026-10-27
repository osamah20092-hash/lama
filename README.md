# Lamma (لمّة) — Voice Rooms & Party Games

An **original** social voice-chat app with in-room party games, built in Unity (C#).
Think: large voice rooms for hanging out + small rooms for turn-based board games.

> This is a from-scratch, original project you own 100%. It is **not** derived from,
> and contains no code or assets from, any existing commercial app. See `docs/LEGAL.md`.

## Stack

| Concern | Technology | Free tier |
|---|---|---|
| Engine / UI | Unity 2022.3 LTS (C#) | ✅ Personal |
| Auth + Realtime DB | Firebase (Auth + Realtime Database) | ✅ Spark plan |
| Voice chat | Agora RTC (voice) | ✅ 10,000 min/mo |
| Push notifications | Firebase Cloud Messaging | ✅ |
| Voice token signing | Node.js token server (`backend/agora-token-server`) | self-host |

## Features (MVP → roadmap)

**MVP (this scaffold):**
- Email / anonymous sign-in (Firebase Auth)
- Lobby: list rooms, create room, join room
- Two room kinds: **Voice room** (up to 20+ seats) and **Game room** (2–8 players)
- Speaker seats, mute, raise-hand, owner/moderator roles
- Realtime voice via Agora (channel = roomId)
- Realtime text chat + presence
- In-room game: **Ludo / Jackaroo** (a traditional, public-domain board game), turn-based, state synced via Firebase

**Roadmap:** friends & profiles, virtual gifts & coins, more games (Dominoes, XO, Trivia), moderation panel.

## Project layout

```
Assets/Scripts/
  Core/      app bootstrap, config, service locator
  Auth/      authentication service + user profile
  Realtime/  thin Firebase Realtime Database wrapper
  Rooms/     room + seat models and room service
  Voice/     Agora voice service (join/leave/mute)
  Chat/      text chat service
  Games/     game framework + Games/Ludo (board rules + sync)
  UI/        screen controllers (prefabs built in the editor)
  Models/    shared data models
backend/agora-token-server/   Node.js server that mints Agora RTC tokens
docs/        ARCHITECTURE, SETUP, LEGAL
```

## Getting started

See **[docs/SETUP.md](docs/SETUP.md)** for the full step-by-step (Unity packages,
Firebase project, Agora app id, token server).

Quick version:
1. Open the folder in **Unity 2022.3 LTS**.
2. Import the **Firebase Unity SDK** (Auth, Database, Messaging) and the **Agora Voice SDK** from their official sites.
3. Drop your `google-services.json` in `Assets/` and fill `Assets/Resources/AppConfig.asset` with your Agora App ID + token server URL.
4. Run the `Bootstrap` scene.

## License

Your code: choose a license (MIT suggested — see `LICENSE`). Third-party SDKs keep their own licenses.
