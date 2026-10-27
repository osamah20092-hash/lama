using System;
using System.Collections.Generic;

namespace Lamma.Models
{
    public enum RoomKind { Voice, Game }
    public enum MemberRole { Member, Mod, Owner }

    [Serializable]
    public class RoomInfo
    {
        public string id;
        public string name;
        public string ownerId;
        public string kind = "voice";       // RoomKind as string for DB
        public bool isLocked;
        public string passwordHash;          // never store raw passwords
        public int maxSeats = 12;
        public string gameType;              // e.g. "ludo" when kind == game
        public long createdAt;

        public RoomKind Kind => kind == "game" ? RoomKind.Game : RoomKind.Voice;
    }

    [Serializable]
    public class RoomMember
    {
        public string uid;
        public string name;
        public string avatarId = "default";
        public string role = "member";
        public long joinedAt;

        public MemberRole Role => role switch
        {
            "owner" => MemberRole.Owner,
            "mod" => MemberRole.Mod,
            _ => MemberRole.Member
        };
    }

    [Serializable]
    public class Seat
    {
        public int index;
        public string uid;        // null/empty = free
        public bool muted;
        public bool speaking;

        public bool IsFree => string.IsNullOrEmpty(uid);
    }

    /// <summary>Live snapshot of a room the UI binds to.</summary>
    public class RoomSnapshot
    {
        public RoomInfo info;
        public readonly List<RoomMember> members = new();
        public readonly List<Seat> seats = new();
    }
}
