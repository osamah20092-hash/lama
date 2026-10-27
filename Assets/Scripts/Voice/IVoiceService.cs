using System;
using System.Threading.Tasks;

namespace Lamma.Voice
{
    public interface IVoiceService
    {
        bool InChannel { get; }
        string CurrentChannel { get; }

        /// <summary>Raised when a remote user's speaking state changes (uid, isSpeaking).</summary>
        event Action<uint, bool> OnSpeakingChanged;
        event Action<uint> OnUserJoined;
        event Action<uint> OnUserLeft;

        Task InitializeAsync();
        Task JoinChannelAsync(string channel, uint uid);
        void SetMuted(bool muted);
        void SetSpeakerEnabled(bool enabled);
        void LeaveChannel();
    }
}
