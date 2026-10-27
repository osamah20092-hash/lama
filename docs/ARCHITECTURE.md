# Architecture

## Overview

```
          ┌─────────────────────────── Unity Client ───────────────────────────┐
          │                                                                     │
  UI  ◄──►│  Core (Bootstrap, ServiceLocator, AppConfig)                        │
          │     │                                                               │
          │     ├─ AuthService ───────────────► Firebase Auth                   │
          │     ├─ RoomService ──┐                                              │
          │     ├─ ChatService ──┼────────────► Firebase Realtime Database      │
          │     ├─ PresenceService ┘            (rooms, seats, chat, game)      │
          │     └─ VoiceService ──────────────► Agora RTC  (channel = roomId)   │
          │                           ▲                                         │
          └───────────────────────────┼─────────────────────────────────────────┘
                                       │ RTC token
                              ┌────────┴─────────┐
                              │ Agora token srv  │  (Node.js, self-hosted)
                              └──────────────────┘
```

## Data model (Realtime Database)

```
/users/{uid}            { name, avatarId, coins, level, createdAt }

/rooms/{roomId}         { name, ownerId, kind: "voice"|"game",
                          isLocked, passwordHash, maxSeats, gameType, createdAt }

/rooms/{roomId}/members/{uid}   { name, avatarId, role: "owner"|"mod"|"member", joinedAt }
/rooms/{roomId}/seats/{index}   { uid, muted, speaking }          // speaker slots
/rooms/{roomId}/chat/{msgId}    { uid, name, text, ts }           // push keys, ordered by ts
/rooms/{roomId}/game            { ...game-specific state }        // see Games/
```

## Service responsibilities

- **AuthService** — sign in/up/out, exposes current `UserProfile`, ensures `/users/{uid}`.
- **RoomService** — create/list/join/leave rooms, seat take/leave, role changes; subscribes
  to a room node and raises C# events the UI binds to.
- **VoiceService** — wraps Agora: `JoinChannel(roomId, uid, token)`, mute, leave, speaking
  callbacks. Fetches a token from the token server.
- **ChatService** — append + stream chat messages for a room.
- **Games** — `IRoomGame` framework; `LudoGame` implements rules and (de)serializes state
  to `/rooms/{roomId}/game`. All clients render the same authoritative state; the current
  player's client validates and writes the next state.

## Turn-based game sync (host-authoritative-by-turn)

Only the client whose turn it is may write the next game state. Everyone subscribes to
`/rooms/{roomId}/game`. A move is: read state → validate locally → apply → write. Firebase
transactions guard against double writes. This keeps it serverless for the MVP; a Cloud
Function can later re-validate moves for anti-cheat.
