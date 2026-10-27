using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Lamma.Realtime;

namespace Lamma.Chat
{
    [Serializable]
    public class ChatMessage
    {
        public string uid;
        public string name;
        public string text;
        public long ts;
    }

    /// <summary>Append + stream text chat for a room (rooms/{id}/chat).</summary>
    public class ChatService
    {
        private readonly FirebaseRealtimeDatabase _db;
        public event Action<ChatMessage> OnMessageAdded;

        public ChatService(FirebaseRealtimeDatabase db) => _db = db;

        public Task SendAsync(string roomId, string uid, string name, string text)
        {
            text = (text ?? "").Trim();
            if (text.Length == 0 || text.Length > 500) return Task.CompletedTask;
            var msg = new ChatMessage
            {
                uid = uid,
                name = name,
                text = text,
                ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            return _db.PushAsync($"rooms/{roomId}/chat", msg);
        }

        // TODO: subscribe to rooms/{id}/chat ChildAdded in the SDK layer and
        // forward each new ChatMessage via OnMessageAdded. Keep only the last ~200
        // messages client-side to bound memory.
        internal void RaiseAdded(ChatMessage m) => OnMessageAdded?.Invoke(m);
    }
}
