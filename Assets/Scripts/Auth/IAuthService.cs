using System;
using System.Threading.Tasks;
using Lamma.Models;

namespace Lamma.Auth
{
    public interface IAuthService
    {
        bool IsSignedIn { get; }
        UserProfile CurrentUser { get; }

        event Action<UserProfile> OnSignedIn;
        event Action OnSignedOut;

        Task InitializeAsync();
        Task<UserProfile> SignInAnonymouslyAsync();
        Task<UserProfile> SignInWithEmailAsync(string email, string password);
        Task<UserProfile> SignUpWithEmailAsync(string email, string password, string displayName);
        Task SignOutAsync();
        Task UpdateDisplayNameAsync(string name);
    }
}
