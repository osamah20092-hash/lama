using System.Threading.Tasks;
using Lamma.Auth;
using Lamma.Chat;
using Lamma.Realtime;
using Lamma.Rooms;
using Lamma.Voice;
using UnityEngine;

namespace Lamma.Core
{
    /// <summary>
    /// App entry point. Put this on a GameObject in the Bootstrap scene.
    /// Initializes Firebase, registers services, then loads the lobby.
    /// </summary>
    public class Bootstrap : MonoBehaviour
    {
        [SerializeField] private bool anonymousSignInForDev = true;

        private async void Start()
        {
            DontDestroyOnLoad(gameObject);
            await InitializeAsync();
        }

        private async Task InitializeAsync()
        {
            Debug.Log("[Bootstrap] Initializing services…");

            var db = new FirebaseRealtimeDatabase();
            await db.InitializeAsync();

            var auth = new FirebaseAuthService(db);
            var rooms = new RoomService(db);
            var chat = new ChatService(db);
            var voice = new AgoraVoiceService(AppConfig.Instance);

            ServiceLocator.Register(db);
            ServiceLocator.Register<IAuthService>(auth);
            ServiceLocator.Register(rooms);
            ServiceLocator.Register(chat);
            ServiceLocator.Register<IVoiceService>(voice);

            await auth.InitializeAsync();
            if (anonymousSignInForDev && !auth.IsSignedIn)
                await auth.SignInAnonymouslyAsync();

            Debug.Log($"[Bootstrap] Ready. Signed in: {auth.IsSignedIn}");
            // TODO: load the Lobby scene / show the lobby screen here.
        }

        private void OnApplicationQuit()
        {
            if (ServiceLocator.TryGet<IVoiceService>(out var voice))
                voice.LeaveChannel();
        }
    }
}
