using System;

namespace Lamma.Models
{
    [Serializable]
    public class UserProfile
    {
        public string uid;
        public string name = "Guest";
        public string avatarId = "default";
        public long coins = 0;
        public int level = 1;
        public long createdAt;

        public UserProfile() { }

        public UserProfile(string uid, string name)
        {
            this.uid = uid;
            this.name = name;
            this.createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
