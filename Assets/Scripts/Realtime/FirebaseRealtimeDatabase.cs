using System;
using System.Threading.Tasks;
using UnityEngine;
#if FIREBASE_PRESENT
using Firebase;
using Firebase.Database;
#endif

namespace Lamma.Realtime
{
    /// <summary>
    /// Thin wrapper over the Firebase Realtime Database Unity SDK.
    /// Wrapped in FIREBASE_PRESENT so the project still compiles before you import
    /// the Firebase SDK. Define the symbol (Player Settings ▸ Scripting Define Symbols)
    /// once FirebaseDatabase.unitypackage is imported.
    /// </summary>
    public class FirebaseRealtimeDatabase
    {
        public bool Ready { get; private set; }

#if FIREBASE_PRESENT
        public FirebaseDatabase Db { get; private set; }

        public async Task InitializeAsync()
        {
            var status = await FirebaseApp.CheckAndFixDependenciesAsync();
            if (status != DependencyStatus.Available)
                throw new Exception($"Firebase dependencies unavailable: {status}");
            Db = FirebaseDatabase.DefaultInstance;
            Ready = true;
        }

        public DatabaseReference Ref(string path) => Db.GetReference(path);

        public async Task SetAsync(string path, object valueJsonSerializable)
        {
            string json = JsonUtility.ToJson(valueJsonSerializable);
            await Ref(path).SetRawJsonValueAsync(json);
        }

        public async Task UpdateChildrenAsync(string path, System.Collections.Generic.Dictionary<string, object> values)
            => await Ref(path).UpdateChildrenAsync(values);

        public async Task<string> PushAsync(string path, object valueJsonSerializable)
        {
            var child = Ref(path).Push();
            await child.SetRawJsonValueAsync(JsonUtility.ToJson(valueJsonSerializable));
            return child.Key;
        }

        public async Task RemoveAsync(string path) => await Ref(path).RemoveValueAsync();
#else
        // --- Stub so the project compiles before Firebase is imported. ---
        public Task InitializeAsync()
        {
            Ready = true;
            Debug.LogWarning("[Firebase] Stub mode. Import Firebase SDK and define FIREBASE_PRESENT.");
            return Task.CompletedTask;
        }

        public Task SetAsync(string path, object v) { Log("SET", path); return Task.CompletedTask; }
        public Task UpdateChildrenAsync(string path, System.Collections.Generic.Dictionary<string, object> v) { Log("UPDATE", path); return Task.CompletedTask; }
        public Task<string> PushAsync(string path, object v) { Log("PUSH", path); return Task.FromResult(Guid.NewGuid().ToString("N")); }
        public Task RemoveAsync(string path) { Log("REMOVE", path); return Task.CompletedTask; }
        private static void Log(string op, string path) => Debug.Log($"[Firebase stub] {op} {path}");
#endif
    }
}
