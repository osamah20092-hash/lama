using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Lamma.Models;
using Lamma.Realtime;
using UnityEngine;

namespace Lamma.Rooms
{
    /// <summary>
    /// Create / join / leave rooms and manage seats. Writes go to Realtime DB;
    /// the UI subscribes to <see cref="OnRoomChanged"/> after JoinRoom.
    /// </summary>
    public class RoomService
    {
        private readonly FirebaseRealtimeDatabase _db;
        public RoomSnapshot Current { get; private set; }
        public event Action<RoomSnapshot> OnRoomChanged;

        public RoomService(FirebaseRealtimeDatabase db) => _db = db;

        public async Task<RoomInfo> CreateRoomAsync(string name, RoomKind kind, string ownerId,
            int maxSeats, string gameType = null, string password = null)
        {
            var info = new RoomInfo
            {
                id = Guid.NewGuid().ToString("N")[..10],
                name = name,
                ownerId = ownerId,
                kind = kind == RoomKind.Game ? "game" : "voice",
                maxSeats = Mathf.Clamp(maxSeats, 2, 25),
                gameType = gameType,
                isLocked = !string.IsNullOrEmpty(password),
                passwordHash = HashPassword(password),
                createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            await _db.SetAsync($"rooms/{info.id}", info);
            return info;
        }

        public async Task JoinRoomAsync(RoomInfo info, UserProfile user, string password = null)
        {
            if (info.isLocked && HashPassword(password) != info.passwordHash)
                throw new UnauthorizedAccessException("Wrong room password.");

            var member = new RoomMember
            {
                uid = user.uid,
                name = user.name,
                avatarId = user.avatarId,
                role = info.ownerId == user.uid ? "owner" : "member",
                joinedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            await _db.SetAsync($"rooms/{info.id}/members/{user.uid}", member);

            Current = new RoomSnapshot { info = info };
            Current.members.Add(member);
            OnRoomChanged?.Invoke(Current);
            // TODO: attach Realtime DB ValueChanged listeners on
            //   rooms/{id}/members, /seats, /chat, /game  → update Current + raise events.
        }

        public async Task LeaveRoomAsync(string uid)
        {
            if (Current == null) return;
            string roomId = Current.info.id;
            await FreeSeatIfHeldAsync(roomId, uid);
            await _db.RemoveAsync($"rooms/{roomId}/members/{uid}");

            // Owner leaves an empty room → delete it.
            if (Current.info.ownerId == uid && Current.members.Count <= 1)
                await _db.RemoveAsync($"rooms/{roomId}");

            Current = null;
            OnRoomChanged?.Invoke(null);
        }

        public async Task TakeSeatAsync(int index, string uid)
        {
            if (Current == null) return;
            var seat = new Seat { index = index, uid = uid, muted = false, speaking = false };
            await _db.SetAsync($"rooms/{Current.info.id}/seats/{index}", seat);
        }

        public Task LeaveSeatAsync(int index)
            => _db.RemoveAsync($"rooms/{Current.info.id}/seats/{index}");

        public Task SetMutedAsync(int index, bool muted)
            => _db.UpdateChildrenAsync($"rooms/{Current.info.id}/seats/{index}",
                new Dictionary<string, object> { ["muted"] = muted });

        public async Task SetRoleAsync(string targetUid, MemberRole role)
        {
            string r = role switch { MemberRole.Owner => "owner", MemberRole.Mod => "mod", _ => "member" };
            await _db.UpdateChildrenAsync($"rooms/{Current.info.id}/members/{targetUid}",
                new Dictionary<string, object> { ["role"] = r });
        }

        private async Task FreeSeatIfHeldAsync(string roomId, string uid)
        {
            if (Current?.seats == null) return;
            foreach (var s in Current.seats)
                if (s.uid == uid) { await _db.RemoveAsync($"rooms/{roomId}/seats/{s.index}"); return; }
        }

        private static string HashPassword(string pw)
        {
            if (string.IsNullOrEmpty(pw)) return null;
            using var sha = System.Security.Cryptography.SHA256.Create();
            var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(pw));
            return Convert.ToBase64String(bytes);
        }
    }
}
