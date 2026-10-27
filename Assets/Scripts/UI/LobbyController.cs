using System.Threading.Tasks;
using Lamma.Auth;
using Lamma.Core;
using Lamma.Models;
using Lamma.Rooms;
using Lamma.Voice;
using UnityEngine;

namespace Lamma.UI
{
    /// <summary>
    /// Example screen controller. Build the actual prefab/Canvas in the Unity editor
    /// and wire buttons to these methods. This shows the intended service flow:
    /// create a room → join it → join voice.
    /// </summary>
    public class LobbyController : MonoBehaviour
    {
        private IAuthService _auth;
        private RoomService _rooms;
        private IVoiceService _voice;

        private void Start()
        {
            _auth = ServiceLocator.Get<IAuthService>();
            _rooms = ServiceLocator.Get<RoomService>();
            _voice = ServiceLocator.Get<IVoiceService>();
        }

        public async void OnCreateVoiceRoom(string roomName)
        {
            var user = _auth.CurrentUser;
            var info = await _rooms.CreateRoomAsync(
                roomName, RoomKind.Voice, user.uid, AppConfig.Instance.defaultVoiceSeats);
            await EnterRoom(info);
        }

        public async void OnCreateGameRoom(string roomName)
        {
            var user = _auth.CurrentUser;
            var info = await _rooms.CreateRoomAsync(
                roomName, RoomKind.Game, user.uid, 4, gameType: "ludo");
            await EnterRoom(info);
        }

        public async void OnJoinRoom(RoomInfo info, string password = null)
            => await EnterRoom(info, password);

        private async Task EnterRoom(RoomInfo info, string password = null)
        {
            var user = _auth.CurrentUser;
            await _rooms.JoinRoomAsync(info, user, password);

            // Agora uid must be a uint; derive a stable one from the Firebase uid.
            uint agoraUid = (uint)(user.uid.GetHashCode() & 0x7fffffff);
            await _voice.JoinChannelAsync(info.id, agoraUid);

            Debug.Log($"[Lobby] entered room '{info.name}' ({info.Kind}), voice channel joined.");
            // TODO: load the Room scene / show RoomController here.
        }
    }
}
