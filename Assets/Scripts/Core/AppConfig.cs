using UnityEngine;

namespace Lamma.Core
{
    /// <summary>
    /// Project configuration. Create one via: Assets ▸ Create ▸ Lamma ▸ App Config
    /// and place it in a Resources folder so it loads at runtime.
    /// Never commit the filled asset — it is in .gitignore.
    /// </summary>
    [CreateAssetMenu(fileName = "AppConfig", menuName = "Lamma/App Config")]
    public class AppConfig : ScriptableObject
    {
        [Header("Agora RTC")]
        [Tooltip("Agora App ID from console.agora.io")]
        public string agoraAppId = "";

        [Tooltip("Base URL of your token server, e.g. https://host/rtc")]
        public string tokenServerUrl = "";

        [Tooltip("If true, join Agora without a token (testing mode only).")]
        public bool useInsecureTokenlessJoin = false;

        [Header("Rooms")]
        public int defaultVoiceSeats = 12;
        public int maxVoiceSeats = 25;
        public int maxGamePlayers = 8;

        private static AppConfig _instance;
        public static AppConfig Instance
        {
            get
            {
                if (_instance == null)
                    _instance = Resources.Load<AppConfig>("AppConfig");
                if (_instance == null)
                    Debug.LogError("AppConfig not found in Resources/. See docs/SETUP.md.");
                return _instance;
            }
        }
    }
}
