using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Lamma.Core;
using UnityEngine;
using UnityEngine.Networking;
#if AGORA_PRESENT
using Agora.Rtc;
#endif

namespace Lamma.Voice
{
    /// <summary>
    /// Agora voice-chat wrapper. Guarded by AGORA_PRESENT so the project compiles
    /// before you import the Agora Voice SDK for Unity. The Agora channel name is the roomId.
    /// Tokens are fetched from your token server (backend/agora-token-server).
    /// </summary>
    public class AgoraVoiceService : IVoiceService
    {
        private readonly AppConfig _config;

        public bool InChannel { get; private set; }
        public string CurrentChannel { get; private set; }

        public event Action<uint, bool> OnSpeakingChanged;
        public event Action<uint> OnUserJoined;
        public event Action<uint> OnUserLeft;

        public AgoraVoiceService(AppConfig config) => _config = config;

        private async Task<string> FetchTokenAsync(string channel, uint uid)
        {
            if (_config.useInsecureTokenlessJoin || string.IsNullOrEmpty(_config.tokenServerUrl))
                return null;

            string url = $"{_config.tokenServerUrl.TrimEnd('/')}/{channel}/{uid}";
            using var req = UnityWebRequest.Get(url);
            var op = req.SendWebRequest();
            while (!op.isDone) await Task.Yield();
            if (req.result != UnityWebRequest.Result.Success)
                throw new Exception($"Token server error: {req.error}");
            return JsonUtility.FromJson<TokenResponse>(req.downloadHandler.text).token;
        }

        [Serializable] private class TokenResponse { public string token; }

#if AGORA_PRESENT
        private IRtcEngine _engine;

        public Task InitializeAsync()
        {
            _engine = RtcEngine.CreateAgoraRtcEngine();
            _engine.Initialize(new RtcEngineContext
            {
                appId = _config.agoraAppId,
                channelProfile = CHANNEL_PROFILE_TYPE.CHANNEL_PROFILE_LIVE_BROADCASTING,
                audioScenario = AUDIO_SCENARIO_TYPE.AUDIO_SCENARIO_CHATROOM
            });
            _engine.InitEventHandler(new Handler(this));
            _engine.EnableAudio();
            // Report who is talking so the UI can light up seats.
            _engine.EnableAudioVolumeIndication(300, 3, true);
            return Task.CompletedTask;
        }

        public async Task JoinChannelAsync(string channel, uint uid)
        {
            string token = await FetchTokenAsync(channel, uid);
            _engine.SetClientRole(CLIENT_ROLE_TYPE.CLIENT_ROLE_BROADCASTER);
            _engine.JoinChannel(token, channel, "", uid);
            CurrentChannel = channel;
            InChannel = true;
        }

        public void SetMuted(bool muted) => _engine?.MuteLocalAudioStream(muted);
        public void SetSpeakerEnabled(bool enabled) => _engine?.SetEnableSpeakerphone(enabled);

        public void LeaveChannel()
        {
            if (!InChannel) return;
            _engine.LeaveChannel();
            InChannel = false; CurrentChannel = null;
        }

        private class Handler : IRtcEngineEventHandler
        {
            private readonly AgoraVoiceService _s;
            public Handler(AgoraVoiceService s) => _s = s;

            public override void OnUserJoined(RtcConnection c, uint uid, int elapsed)
                => _s.OnUserJoined?.Invoke(uid);
            public override void OnUserOffline(RtcConnection c, uint uid, USER_OFFLINE_REASON_TYPE r)
                => _s.OnUserLeft?.Invoke(uid);
            public override void OnAudioVolumeIndication(RtcConnection c, AudioVolumeInfo[] speakers, uint count, int total)
            {
                foreach (var sp in speakers)
                    _s.OnSpeakingChanged?.Invoke(sp.uid, sp.volume > 5);
            }
        }
#else
        public Task InitializeAsync()
        {
            Debug.LogWarning("[Agora] Stub mode. Import Agora Voice SDK and define AGORA_PRESENT.");
            return Task.CompletedTask;
        }

        public async Task JoinChannelAsync(string channel, uint uid)
        {
            await FetchTokenAsync(channel, uid); // still exercises the token path in dev
            CurrentChannel = channel; InChannel = true;
            Debug.Log($"[Agora stub] joined channel '{channel}' as {uid}");
        }

        public void SetMuted(bool muted) => Debug.Log($"[Agora stub] muted={muted}");
        public void SetSpeakerEnabled(bool enabled) => Debug.Log($"[Agora stub] speaker={enabled}");
        public void LeaveChannel() { InChannel = false; CurrentChannel = null; Debug.Log("[Agora stub] left channel"); }
#endif
    }
}
