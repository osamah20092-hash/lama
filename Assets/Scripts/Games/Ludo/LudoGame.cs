using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Lamma.Games.Ludo
{
    /// <summary>
    /// A clean-room implementation of a classic cross-and-circle race game
    /// (Ludo / Jackaroo family — traditional, public-domain rules). Write your own
    /// board art and tune constants; do not import any other app's assets.
    ///
    /// Board model (standard Ludo): 4 players, 4 tokens each, a 52-step shared ring
    /// plus a 6-step private home column. Roll a 6 to leave base; exact roll to finish.
    /// </summary>
    [Serializable]
    public class LudoState
    {
        public const int RingLength = 52;
        public const int HomeColumn = 6;
        public const int TokensPerPlayer = 4;

        public List<string> playerUids = new();   // seat order; index = color 0..3
        public int currentPlayer;                   // index into playerUids
        public int lastRoll;                        // 1..6, 0 = not rolled yet
        public bool awaitingMove;                   // a roll is pending a token move
        public int[] tokenPos;                      // length players*4; -1 base, 0..51 ring, 100+ home, 200 finished
        public int[] rngState = new int[1];         // simple shared RNG seed/counter

        public static LudoState NewGame(List<string> uids)
        {
            int p = Mathf.Clamp(uids.Count, 2, 4);
            var s = new LudoState
            {
                playerUids = uids.Take(p).ToList(),
                currentPlayer = 0,
                lastRoll = 0,
                awaitingMove = false,
                tokenPos = Enumerable.Repeat(-1, p * TokensPerPlayer).ToArray(),
                rngState = new[] { Environment.TickCount }
            };
            return s;
        }
    }

    public class LudoGame : IRoomGame
    {
        public string GameType => "ludo";
        public event Action OnStateChanged;

        public LudoState State { get; private set; }

        public LudoGame(LudoState state = null) { State = state; }

        public void Start(List<string> uids)
        {
            State = LudoState.NewGame(uids);
            OnStateChanged?.Invoke();
        }

        public bool IsPlayerTurn(string uid)
            => State != null && State.playerUids.Count > 0 &&
               State.playerUids[State.currentPlayer] == uid;

        /// <summary>Entry point in the ring for a color (standard Ludo spacing).</summary>
        public static int StartCell(int color) => (color * 13) % LudoState.RingLength;

        // ---- Turn flow ----------------------------------------------------

        public int Roll(string uid)
        {
            if (!IsPlayerTurn(uid) || State.awaitingMove) return 0;
            int roll = NextDie();
            State.lastRoll = roll;
            State.awaitingMove = HasAnyLegalMove(State.currentPlayer, roll);
            if (!State.awaitingMove) AdvanceTurn(rolledSix: roll == 6); // nothing to do → pass
            OnStateChanged?.Invoke();
            return roll;
        }

        public bool MoveToken(string uid, int tokenIndex)
        {
            if (!IsPlayerTurn(uid) || !State.awaitingMove) return false;
            int player = State.currentPlayer;
            int global = player * LudoState.TokensPerPlayer + tokenIndex;
            if (!IsLegalMove(player, global, State.lastRoll)) return false;

            ApplyMove(player, global, State.lastRoll);
            bool sentHome = CaptureAt(player, global);
            State.awaitingMove = false;

            bool extraTurn = State.lastRoll == 6 || sentHome || JustFinishedToken(global);
            if (!extraTurn) AdvanceTurn(rolledSix: false);
            else State.lastRoll = 0;

            OnStateChanged?.Invoke();
            return true;
        }

        // ---- Rules --------------------------------------------------------

        private bool HasAnyLegalMove(int player, int roll)
        {
            for (int t = 0; t < LudoState.TokensPerPlayer; t++)
                if (IsLegalMove(player, player * LudoState.TokensPerPlayer + t, roll)) return true;
            return false;
        }

        private bool IsLegalMove(int player, int global, int roll)
        {
            int pos = State.tokenPos[global];
            if (pos == 200) return false;                     // finished
            if (pos == -1) return roll == 6;                  // leave base only on a 6
            int target = ProjectedPosition(player, pos, roll);
            return target != int.MinValue;                    // valid, in-range move
        }

        /// <summary>Returns new encoded position, or int.MinValue if the move overshoots home.</summary>
        private int ProjectedPosition(int player, int pos, int roll)
        {
            int start = StartCell(player);
            int homeEntry = (start + LudoState.RingLength - 1) % LudoState.RingLength; // cell before start

            if (pos >= 100)                                   // already in home column
            {
                int step = pos - 100 + roll;
                if (step > LudoState.HomeColumn) return int.MinValue;
                return step == LudoState.HomeColumn ? 200 : 100 + step;
            }

            // distance travelled along the ring from this color's start
            int travelled = (pos - start + LudoState.RingLength) % LudoState.RingLength;
            int newTravelled = travelled + roll;
            if (newTravelled < LudoState.RingLength) // still on the ring
                return (pos + roll) % LudoState.RingLength;

            int intoHome = newTravelled - LudoState.RingLength; // 0-based into home column
            if (intoHome > LudoState.HomeColumn) return int.MinValue;
            return intoHome == LudoState.HomeColumn ? 200 : 100 + intoHome;
        }

        private void ApplyMove(int player, int global, int roll)
        {
            int pos = State.tokenPos[global];
            State.tokenPos[global] = pos == -1 ? StartCell(player) : ProjectedPosition(player, pos, roll);
        }

        /// <summary>Send any opponent token sharing this ring cell back to base. Safe cells excluded.</summary>
        private bool CaptureAt(int player, int movedGlobal)
        {
            int pos = State.tokenPos[movedGlobal];
            if (pos < 0 || pos >= 100) return false;          // only ring cells capture
            if (IsSafeCell(pos)) return false;

            bool captured = false;
            for (int g = 0; g < State.tokenPos.Length; g++)
            {
                if (g / LudoState.TokensPerPlayer == player) continue;
                if (State.tokenPos[g] == pos) { State.tokenPos[g] = -1; captured = true; }
            }
            return captured;
        }

        private static bool IsSafeCell(int cell)
        {
            // Each color's start cell and the star cells (8 cells apart) are safe.
            for (int c = 0; c < 4; c++)
            {
                if (cell == StartCell(c)) return true;
                if (cell == (StartCell(c) + 8) % LudoState.RingLength) return true;
            }
            return false;
        }

        private bool JustFinishedToken(int global) => State.tokenPos[global] == 200;

        private void AdvanceTurn(bool rolledSix)
        {
            State.lastRoll = 0;
            State.awaitingMove = false;
            State.currentPlayer = (State.currentPlayer + 1) % State.playerUids.Count;
        }

        public bool IsWinner(int player)
        {
            for (int t = 0; t < LudoState.TokensPerPlayer; t++)
                if (State.tokenPos[player * LudoState.TokensPerPlayer + t] != 200) return false;
            return true;
        }

        // ---- Shared deterministic die (so all clients agree) --------------

        private int NextDie()
        {
            // xorshift on the shared seed; every client computing from the same
            // serialized state gets the same next value.
            uint x = (uint)State.rngState[0];
            x ^= x << 13; x ^= x >> 17; x ^= x << 5;
            State.rngState[0] = (int)x;
            return (int)(x % 6) + 1;
        }

        // ---- Serialization ------------------------------------------------

        public string Serialize() => JsonUtility.ToJson(State);

        public void Deserialize(string json)
        {
            State = JsonUtility.FromJson<LudoState>(json);
            OnStateChanged?.Invoke();
        }
    }
}
