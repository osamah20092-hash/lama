using System;
using System.Threading.Tasks;
using Lamma.Models;
using Lamma.Realtime;
using UnityEngine;
#if FIREBASE_PRESENT
using Firebase.Auth;
#endif

namespace Lamma.Auth
{
    public class FirebaseAuthService : IAuthService
    {
        private readonly FirebaseRealtimeDatabase _db;

        public bool IsSignedIn => CurrentUser != null;
        public UserProfile CurrentUser { get; private set; }

        public event Action<UserProfile> OnSignedIn;
        public event Action OnSignedOut;

        public FirebaseAuthService(FirebaseRealtimeDatabase db) => _db = db;

#if FIREBASE_PRESENT
        private FirebaseAuth _auth;

        public Task InitializeAsync()
        {
            _auth = FirebaseAuth.DefaultInstance;
            if (_auth.CurrentUser != null)
                CurrentUser = ToProfile(_auth.CurrentUser);
            return Task.CompletedTask;
        }

        public async Task<UserProfile> SignInAnonymouslyAsync()
        {
            var result = await _auth.SignInAnonymouslyAsync();
            return await FinishSignIn(result.User, "Guest");
        }

        public async Task<UserProfile> SignInWithEmailAsync(string email, string password)
        {
            var result = await _auth.SignInWithEmailAndPasswordAsync(email, password);
            return await FinishSignIn(result.User, result.User.DisplayName);
        }

        public async Task<UserProfile> SignUpWithEmailAsync(string email, string password, string displayName)
        {
            var result = await _auth.CreateUserWithEmailAndPasswordAsync(email, password);
            await result.User.UpdateUserProfileAsync(new UserProfile_Firebase { DisplayName = displayName });
            return await FinishSignIn(result.User, displayName);
        }

        public Task SignOutAsync()
        {
            _auth.SignOut();
            CurrentUser = null;
            OnSignedOut?.Invoke();
            return Task.CompletedTask;
        }

        public async Task UpdateDisplayNameAsync(string name)
        {
            if (_auth.CurrentUser == null) return;
            await _auth.CurrentUser.UpdateUserProfileAsync(new UserProfile_Firebase { DisplayName = name });
            if (CurrentUser != null) { CurrentUser.name = name; await EnsureUserNode(CurrentUser); }
        }

        private async Task<UserProfile> FinishSignIn(FirebaseUser user, string name)
        {
            CurrentUser = ToProfile(user);
            if (!string.IsNullOrEmpty(name)) CurrentUser.name = name;
            await EnsureUserNode(CurrentUser);
            OnSignedIn?.Invoke(CurrentUser);
            return CurrentUser;
        }

        private static UserProfile ToProfile(FirebaseUser u)
            => new UserProfile(u.UserId, string.IsNullOrEmpty(u.DisplayName) ? "Guest" : u.DisplayName);

        // Alias to avoid clashing with our model name.
        private sealed class UserProfile_Firebase : Firebase.Auth.UserProfile { }
#else
        public Task InitializeAsync() => Task.CompletedTask;

        public async Task<UserProfile> SignInAnonymouslyAsync()
            => await FakeSignIn("anon-" + Guid.NewGuid().ToString("N")[..8], "Guest");

        public async Task<UserProfile> SignInWithEmailAsync(string email, string password)
            => await FakeSignIn("email-" + email.GetHashCode(), email.Split('@')[0]);

        public async Task<UserProfile> SignUpWithEmailAsync(string email, string password, string displayName)
            => await FakeSignIn("email-" + email.GetHashCode(), displayName);

        public Task SignOutAsync() { CurrentUser = null; OnSignedOut?.Invoke(); return Task.CompletedTask; }
        public Task UpdateDisplayNameAsync(string name) { if (CurrentUser != null) CurrentUser.name = name; return Task.CompletedTask; }

        private async Task<UserProfile> FakeSignIn(string uid, string name)
        {
            CurrentUser = new UserProfile(uid, name);
            await EnsureUserNode(CurrentUser);
            OnSignedIn?.Invoke(CurrentUser);
            Debug.Log($"[Auth stub] signed in as {name} ({uid})");
            return CurrentUser;
        }
#endif

        private Task EnsureUserNode(UserProfile p) => _db.SetAsync($"users/{p.uid}", p);
    }
}
