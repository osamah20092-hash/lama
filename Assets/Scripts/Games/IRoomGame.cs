using System;

namespace Lamma.Games
{
    /// <summary>
    /// Contract for any in-room, turn-based game. State is serialized to
    /// rooms/{roomId}/game and mirrored on every client. Only the client whose
    /// turn it is writes the next state (see docs/ARCHITECTURE.md).
    /// </summary>
    public interface IRoomGame
    {
        string GameType { get; }

        /// <summary>Raised whenever the local model changes (after a local move or a remote update).</summary>
        event Action OnStateChanged;

        /// <summary>Serialize current state to JSON for the DB.</summary>
        string Serialize();

        /// <summary>Load state from JSON pulled from the DB.</summary>
        void Deserialize(string json);

        /// <summary>Is it this player's turn?</summary>
        bool IsPlayerTurn(string uid);
    }
}
