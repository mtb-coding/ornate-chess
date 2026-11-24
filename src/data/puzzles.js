/**
 * Ornate Chess — verified tactics puzzle database.
 * Every entry is engine-checked. Hard puzzles with a lichess: source id
 * come from the CC0 Lichess puzzle database (database.lichess.org).
 */
export const PUZZLES = [
  {
    "id": "br-20",
    "title": "Back-rank mate with rook",
    "theme": "back-rank",
    "difficulty": 1,
    "rating": 900,
    "fen": "3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1",
    "solution": [
      "d8d1"
    ],
    "hint": "White left the first rank undefended.",
    "explanation": "Rook to d1 is checkmate on the back rank."
  },
  {
    "id": "br-02",
    "title": "Back-rank double rook",
    "theme": "back-rank",
    "difficulty": 2,
    "rating": 1100,
    "fen": "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 1",
    "solution": [
      "a8a1"
    ],
    "hint": "The a-file is open to the first rank.",
    "explanation": "Rook to a1 mates because white has no flight square."
  },
  {
    "id": "df-01",
    "title": "Deflect the back-rank defender",
    "theme": "deflection",
    "difficulty": 3,
    "rating": 1400,
    "fen": "3r2k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1",
    "solution": [
      "e2e8",
      "d8e8",
      "e1e8"
    ],
    "hint": "Force the defending rook off its file with a check on the back rank.",
    "explanation": "Rook to e8 checks the king and must be captured by the defending rook. The queen then recaptures on e8 and mates because the black pawns block their king."
  },
  {
    "id": "df-02",
    "title": "Deflect the rook, then mate",
    "theme": "deflection",
    "difficulty": 3,
    "rating": 1400,
    "fen": "r5k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1",
    "solution": [
      "e2e8",
      "a8e8",
      "e1e8"
    ],
    "hint": "Sacrifice on e8 so that the queen can enter on the back rank.",
    "explanation": "Rook to e8 forces the defending rook to recapture. The queen then recaptures on e8 and mates on the back rank."
  },
  {
    "id": "df-20",
    "title": "Rook sacrifice deflects the defender",
    "theme": "deflection",
    "difficulty": 3,
    "rating": 1450,
    "fen": "2r3k1/5ppp/8/8/8/8/4RPPP/4Q1K1 w - - 0 1",
    "solution": [
      "e2e8",
      "c8e8",
      "e1e8"
    ],
    "hint": "Give check on e8 to pull the defender onto that square.",
    "explanation": "Rook to e8 is a check that the black rook must capture. The queen then recaptures on e8 and mates on the back rank."
  },
  {
    "id": "df-21",
    "title": "Deflection by a rook check",
    "theme": "deflection",
    "difficulty": 3,
    "rating": 1400,
    "fen": "r5k1/5ppp/8/8/8/8/2R2PPP/2Q3K1 w - - 0 1",
    "solution": [
      "c2c8",
      "a8c8",
      "c1c8"
    ],
    "hint": "Check on c8 so that the defending rook is forced to recapture.",
    "explanation": "Rook to c8 checks the king and is captured by the defending rook. The queen recaptures on c8 and mates because the black pawns block their king."
  },
  {
    "id": "ds-20",
    "title": "Discovered check captures the queen",
    "theme": "discovered",
    "difficulty": 3,
    "rating": 1450,
    "fen": "4k3/3q4/8/4N3/8/8/8/4R1K1 w - - 0 1",
    "solution": [
      "e5d7"
    ],
    "hint": "Capture the queen with a move that also uncovers the rook.",
    "explanation": "The knight captures the queen on d7 and uncovers a check from the rook on e1. If the king recaptures, White has won a queen for a knight."
  },
  {
    "id": "eg-22",
    "title": "Activate the king in a pawn ending",
    "theme": "endgame",
    "difficulty": 2,
    "rating": 1200,
    "fen": "8/8/8/3k4/3P4/8/3K4/8 w - - 0 1",
    "solution": [
      "d2e3"
    ],
    "hint": "Bring the king forward to support the pawn, either to e3 or to d3.",
    "explanation": "King to e3 or d3 supports the pawn and wins the pawn ending.",
    "alternatives": [
      [
        "d2e3",
        "d2d3"
      ]
    ]
  },
  {
    "id": "eg-21",
    "title": "Mate in three",
    "theme": "mate-in-3",
    "difficulty": 4,
    "rating": 1904,
    "fen": "3R3Q/1p1r4/p2kp3/3p1p2/3P1q2/2P5/PP4P1/6K1 w - - 0 1",
    "solution": [
      "h8f8",
      "d6c7",
      "d8c8",
      "c7b6",
      "f8c5"
    ],
    "hint": "Look for a forcing sequence that mates on the third move.",
    "explanation": "The solution begins with Qf8+. The forced line is Qf8+ Kc7 Rc8+ Kb6 Qc5#, ending in checkmate.",
    "source": "lichess:02eLf"
  },
  {
    "id": "fk-03",
    "title": "Pawn forks king and knight",
    "theme": "fork",
    "difficulty": 1,
    "rating": 850,
    "fen": "8/8/3k1n2/8/4P3/8/8/4K3 w - - 0 1",
    "solution": [
      "e4e5"
    ],
    "hint": "Advance the pawn so that it attacks the king and the knight.",
    "explanation": "Pawn to e5 attacks the king on d6 and the knight on f6 at the same time."
  },
  {
    "id": "fk-23",
    "title": "Pawn forks two knights",
    "theme": "fork",
    "difficulty": 1,
    "rating": 950,
    "fen": "8/8/2n1n3/8/3P4/8/8/4K1k1 w - - 0 1",
    "solution": [
      "d4d5"
    ],
    "hint": "Advance the pawn so both knights are attacked.",
    "explanation": "Pawn to d5 attacks the knights on c6 and e6 at the same time, so one of them is lost."
  },
  {
    "id": "fk-02",
    "title": "Knight forks king and queen",
    "theme": "fork",
    "difficulty": 2,
    "rating": 1100,
    "fen": "4k3/8/8/8/2q1N3/8/8/4K3 w - - 0 1",
    "solution": [
      "e4d6"
    ],
    "hint": "Find the checking square that also attacks the queen.",
    "explanation": "Knight to d6 checks the king and attacks the queen at the same time, so the queen is lost."
  },
  {
    "id": "fk-22",
    "title": "Knight forks king and rook",
    "theme": "fork",
    "difficulty": 2,
    "rating": 1150,
    "fen": "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
    "solution": [
      "d5c7"
    ],
    "hint": "Check the king while attacking the undefended rook.",
    "explanation": "Knight to c7 forks king and rook."
  },
  {
    "id": "gen-mate-in-1-13",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "2R5/k7/8/1K2N3/8/8/8/1Q6 w - - 0 1",
    "solution": [
      "b1h7"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-14",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "k7/8/K7/P7/7p/5R2/8/8 w - - 0 1",
    "solution": [
      "f3f8"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-18",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/5K2/8/8/8/7R/5Q2/1n1k4 w - - 0 1",
    "solution": [
      "h3h1"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-19",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/8/8/6R1/1k6/8/K4Q2/8 w - - 0 1",
    "solution": [
      "f2d4"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-21",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "4k3/7R/b1K5/3p4/8/8/B5R1/8 w - - 0 1",
    "solution": [
      "g2g8"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-25",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "7k/1B6/4B3/5N2/4P3/8/5R2/1K6 w - - 0 1",
    "solution": [
      "f2h2"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-29",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "6N1/8/R7/1k3N2/7Q/3K4/8/8 w - - 0 1",
    "solution": [
      "h4c4"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-33",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/K7/2N5/Q7/6R1/8/1N6/7k w - - 0 1",
    "solution": [
      "a5h5"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-34",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/5R2/8/8/8/KN6/6B1/1k6 w - - 0 1",
    "solution": [
      "g2e4"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-36",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/2Q5/8/3k3p/8/2K5/8/4R3 w - - 0 1",
    "solution": [
      "e1e5"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-39",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/B7/2k5/2B5/3Q4/8/8/KR4R1 w - - 0 1",
    "solution": [
      "d4d6"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-40",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "7q/8/8/8/3R4/6KP/8/7k w - - 0 1",
    "solution": [
      "d4d1"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-41",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "5K1k/8/8/6R1/8/6N1/8/8 w - - 0 1",
    "solution": [
      "g5h5"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-42",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/2R5/8/3k4/5P2/8/2K5/4Q3 w - - 0 1",
    "solution": [
      "e1e5"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-5",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "1qQ5/8/1n6/k7/8/2K5/4B3/8 w - - 0 1",
    "solution": [
      "c8a6"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "gen-mate-in-1-8",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 900,
    "fen": "Q1R5/8/8/1k1K2B1/8/8/8/3N4 w - - 0 1",
    "solution": [
      "c8b8"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move."
  },
  {
    "id": "m1-01",
    "title": "Back-rank rook mate",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 850,
    "fen": "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
    "solution": [
      "e1e8"
    ],
    "hint": "The black king is trapped on the back rank.",
    "explanation": "Rook to e8 is checkmate because the pawns on f7, g7, and h7 block the king."
  },
  {
    "id": "m1-02",
    "title": "Back-rank queen mate",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 850,
    "fen": "6k1/5ppp/8/8/8/8/5PPP/Q5K1 w - - 0 1",
    "solution": [
      "a1a8"
    ],
    "hint": "Use the open file to the eighth rank.",
    "explanation": "Queen to a8 (or d8) mates on the back rank."
  },
  {
    "id": "m1-03",
    "title": "Supported queen mate",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 850,
    "fen": "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
    "solution": [
      "f7g7"
    ],
    "hint": "Place the queen next to the king.",
    "explanation": "Queen to g7 or h7 is mate with the king supporting.",
    "alternatives": [
      [
        "f7g7",
        "f7h7",
        "f7f8",
        "f7e8"
      ]
    ]
  },
  {
    "id": "m1-07",
    "title": "Queen mate on the open file",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 850,
    "fen": "6k1/6pp/8/8/8/8/4Q1PP/6K1 w - - 0 1",
    "solution": [
      "e2e8"
    ],
    "hint": "The e-file is open to the eighth rank.",
    "explanation": "Queen to e8 is checkmate. The black pawns on g7 and h7 leave the king with no safe flight square."
  },
  {
    "id": "m1-08",
    "title": "Rook file mate against cornered king",
    "theme": "mate-in-1",
    "difficulty": 1,
    "rating": 850,
    "fen": "7k/6pp/8/8/8/8/6PP/1R4K1 w - - 0 1",
    "solution": [
      "b1b8"
    ],
    "hint": "The back rank is open.",
    "explanation": "Rook to b8 is checkmate."
  },
  {
    "id": "gen-mate-in-1-10",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "1R6/7R/k7/8/8/8/8/2Q3K1 w - - 0 1",
    "solution": [
      "c1a1"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "c1a1",
        "c1a3"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-15",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "1k6/3R2P1/8/8/8/1K1R4/6P1/2Q5 w - - 0 1",
    "solution": [
      "g7g8q"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "g7g8q",
        "g7g8r"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-17",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "4NK2/8/8/1Q6/6k1/4R3/1Q6/8 w - - 0 1",
    "solution": [
      "b2b4"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "b2b4",
        "b2d4"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-3",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "8/1r6/5QK1/8/6k1/4R3/8/8 w - - 0 1",
    "solution": [
      "f6g5"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "f6g5",
        "f6d4"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-32",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "2k5/q6P/2K5/8/5N2/6N1/8/8 w - - 0 1",
    "solution": [
      "h7h8q"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "h7h8q",
        "h7h8r"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-38",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "8/Q4QK1/8/8/8/8/7Q/2k5 w - - 0 1",
    "solution": [
      "a7a1"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "a7a1",
        "a7g1",
        "f7f1"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-6",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "5N2/6K1/8/1R6/3Q4/6p1/k7/8 w - - 0 1",
    "solution": [
      "d4a4"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "d4a4",
        "d4a7",
        "d4b2"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-7",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "7k/3R4/8/p7/1PQ5/2R5/8/3K4 w - - 0 1",
    "solution": [
      "c3h3"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "c3h3",
        "c4c8"
      ]
    ]
  },
  {
    "id": "gen-mate-in-1-9",
    "title": "Mate in one",
    "theme": "mate-in-1",
    "difficulty": 2,
    "rating": 1100,
    "fen": "8/P7/8/1Q6/5K2/8/8/k4n2 w - - 0 1",
    "solution": [
      "a7a8q"
    ],
    "hint": "Find a move that leaves the opposing king with no escape.",
    "explanation": "The solution delivers checkmate in a single move.",
    "alternatives": [
      [
        "a7a8q",
        "a7a8r"
      ]
    ]
  },
  {
    "id": "m1-06",
    "title": "Knight smothered mate net",
    "theme": "mate-in-1",
    "difficulty": 3,
    "rating": 1400,
    "fen": "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
    "solution": [
      "g5f7"
    ],
    "hint": "The knight can check from a square the king cannot escape.",
    "explanation": "Knight to f7 is checkmate because the king is boxed in by its own rook and pawns."
  },
  {
    "id": "m2-02",
    "title": "Back-rank queen mate",
    "theme": "mate-in-1",
    "difficulty": 3,
    "rating": 1400,
    "fen": "6k1/5ppp/8/8/8/8/5PQP/6K1 w - - 0 1",
    "solution": [
      "g2a8"
    ],
    "hint": "The eighth rank is open to the queen.",
    "explanation": "Queen to a8 is checkmate on the back rank because the pawns on f7, g7, and h7 block the king."
  },
  {
    "id": "m2-01",
    "title": "Ladder mate start",
    "theme": "mate-in-2",
    "difficulty": 2,
    "rating": 1100,
    "fen": "k7/8/1R6/8/8/8/1R6/6K1 w - - 0 1",
    "solution": [
      "b6b5",
      "a8a7",
      "b2a2"
    ],
    "hint": "Check on the seventh rank, then mate on the eighth.",
    "explanation": "The rooks alternate checks on consecutive ranks to force mate.",
    "alternatives": [
      [
        "b2a2",
        "b6a6",
        "b6b5",
        "b6b4",
        "b6b3"
      ]
    ]
  },
  {
    "id": "m2-04",
    "title": "Rook check then mate",
    "theme": "mate-in-2",
    "difficulty": 2,
    "rating": 1100,
    "fen": "7k/5R2/6K1/8/8/8/8/8 w - - 0 1",
    "solution": [
      "f7e7",
      "h8g8",
      "e7e8"
    ],
    "hint": "Keep the king confined, then deliver the final check.",
    "explanation": "After a checking retreat or lift, the rook mates on the edge.",
    "alternatives": [
      [
        "f7e7",
        "f7d7",
        "f7c7",
        "f7b7",
        "f7a7",
        "f7f8"
      ]
    ]
  },
  {
    "id": "m2-06",
    "title": "Queen check forces mate",
    "theme": "mate-in-2",
    "difficulty": 2,
    "rating": 1100,
    "fen": "5k2/8/5K2/8/8/8/8/5Q2 w - - 0 1",
    "solution": [
      "f1c4",
      "f8e8",
      "c4c8"
    ],
    "hint": "Check so that the king must step into a mating net.",
    "explanation": "The queen checks and the follow-up mates with king support."
  },
  {
    "id": "m2-07",
    "title": "Corner mate with rook and king",
    "theme": "mate-in-2",
    "difficulty": 2,
    "rating": 1100,
    "fen": "7k/8/6K1/5R2/8/8/8/8 w - - 0 1",
    "solution": [
      "f5e5",
      "h8g8",
      "e5e8"
    ],
    "hint": "Cut the escape file, then mate on the edge.",
    "explanation": "The rook and king force the black king into the corner for mate.",
    "alternatives": [
      [
        "f5e5",
        "f5d5",
        "f5c5",
        "f5b5",
        "f5a5",
        "f5f8",
        "g6f7"
      ]
    ]
  },
  {
    "id": "gen-mate-in-2-11",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/k4K2/1N6/8/1R6/8/4Q3/4r3 w - - 0 1",
    "solution": [
      "b6c8",
      "a7a8",
      "e2a2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-12",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/4rr2/6R1/8/8/1k1K4/3R4/1N6 w - - 0 1",
    "solution": [
      "g6b6",
      "b3a4",
      "d2a2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-16",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "2Q5/1Q3B2/5K2/k5q1/8/8/8/8 w - - 0 1",
    "solution": [
      "f6g5",
      "a5a4",
      "c8a8"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-20",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "5Q2/1n6/7R/8/8/n7/6k1/2K5 w - - 0 1",
    "solution": [
      "h6g6",
      "g2h2",
      "f8h8"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-22",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/8/4Q3/4K3/2R2N2/8/2p5/k7 w - - 0 1",
    "solution": [
      "c4c2",
      "a1b1",
      "e6a2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-23",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/1P1R4/1k4b1/2r5/3K4/8/8/4q3 w - - 0 1",
    "solution": [
      "b7b8q",
      "b6c6",
      "d7d6"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-24",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "2B5/2P5/8/8/8/5k2/3Q4/6K1 w - - 0 1",
    "solution": [
      "c8f5",
      "f3g3",
      "d2f2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-26",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/3P4/8/2K5/5B2/R7/nR6/6k1 w - - 0 1",
    "solution": [
      "a3a2",
      "g1h1",
      "a2a1"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-27",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/3K4/8/1R6/8/1R1n4/k4P2/8 w - - 0 1",
    "solution": [
      "b3d3",
      "a2a1",
      "d3a3"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-28",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/1k6/8/4B3/7Q/r7/2Q5/6K1 w - - 0 1",
    "solution": [
      "c2c7",
      "b7a8",
      "h4e4"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-30",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/7k/3K4/Q7/8/R7/8/8 w - - 0 1",
    "solution": [
      "a5g5",
      "h7h8",
      "a3h3"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-31",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "K7/8/1P3b1R/2B5/3Q4/8/k7/8 w - - 0 1",
    "solution": [
      "h6h2",
      "a2b3",
      "h2b2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-35",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "4N3/8/N5k1/8/Q1Q5/8/Kp6/8 w - - 0 1",
    "solution": [
      "c4e6",
      "g6g5",
      "a4g4"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-37",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/1r6/8/8/8/7R/1k6/R4KQ1 w - - 0 1",
    "solution": [
      "g1d4",
      "b2c2",
      "d4f2"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "gen-mate-in-2-4",
    "title": "Mate in two",
    "theme": "mate-in-2",
    "difficulty": 3,
    "rating": 1400,
    "fen": "8/8/8/6N1/8/1K6/7R/3B1k2 w - - 0 1",
    "solution": [
      "d1e2",
      "f1g1",
      "g5f3"
    ],
    "hint": "Force a position where mate cannot be avoided next move.",
    "explanation": "After the forcing move, every defense allows mate on the following turn."
  },
  {
    "id": "m3-01",
    "title": "Ladder mate in three",
    "theme": "mate-in-3",
    "difficulty": 3,
    "rating": 1500,
    "fen": "4k3/8/8/1R6/8/1R6/8/6K1 w - - 0 1",
    "solution": [
      "b5b7",
      "e8f8",
      "b3c3",
      "f8g8",
      "c3c8"
    ],
    "hint": "Cut the seventh rank first, then finish with the other rook.",
    "explanation": "Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move."
  },
  {
    "id": "m3-hand-2",
    "title": "Ladder mate in three",
    "theme": "mate-in-3",
    "difficulty": 3,
    "rating": 1540,
    "fen": "3k4/8/8/1R6/8/1R6/8/6K1 w - - 0 1",
    "solution": [
      "b5b7",
      "d8e8",
      "b3d3",
      "e8f8",
      "d3d8"
    ],
    "hint": "Cut the seventh rank first, then finish with the other rook.",
    "explanation": "Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move."
  },
  {
    "id": "m3-hand-3",
    "title": "Ladder mate in three",
    "theme": "mate-in-3",
    "difficulty": 3,
    "rating": 1560,
    "fen": "2k5/8/8/1R6/8/1R6/8/6K1 w - - 0 1",
    "solution": [
      "b5b7",
      "c8d8",
      "b3c3",
      "d8e8",
      "c3c8"
    ],
    "hint": "Cut the seventh rank first, then finish with the other rook.",
    "explanation": "Rook to b7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move."
  },
  {
    "id": "m3-hand-4",
    "title": "Ladder mate in three",
    "theme": "mate-in-3",
    "difficulty": 3,
    "rating": 1580,
    "fen": "5k2/8/8/6R1/8/6R1/8/6K1 w - - 0 1",
    "solution": [
      "g5g7",
      "f8e8",
      "g3f3",
      "e8d8",
      "f3f8"
    ],
    "hint": "Cut the seventh rank first, then finish with the other rook.",
    "explanation": "Rook to g7 cuts the seventh rank so the black king cannot step forward. The second rook then mates on the eighth rank on the third move."
  },
  {
    "id": "pn-20",
    "title": "Absolute pin on the knight",
    "theme": "pin",
    "difficulty": 2,
    "rating": 1250,
    "fen": "3k4/8/8/3n4/8/8/8/3RK3 w - - 0 1",
    "solution": [
      "d1d5"
    ],
    "hint": "The knight cannot leave the file of its king.",
    "explanation": "The knight on d5 is pinned to the king, so the rook can capture it. The king cannot recapture because the rook is protected by the white king, and the pin already prevented the knight from escaping."
  },
  {
    "id": "pn-21",
    "title": "Absolute pin wins material",
    "theme": "pin",
    "difficulty": 2,
    "rating": 1300,
    "fen": "3k4/8/8/3q4/8/8/8/3RK3 w - - 0 1",
    "solution": [
      "d1d5"
    ],
    "hint": "The queen cannot leave the file without exposing the king.",
    "explanation": "Rook captures the pinned queen on the d-file."
  },
  {
    "id": "pn-22",
    "title": "Bishop pins the knight to the king",
    "theme": "pin",
    "difficulty": 2,
    "rating": 1200,
    "fen": "6k1/8/8/3n4/8/8/8/1B4K1 w - - 0 1",
    "solution": [
      "b1a2"
    ],
    "hint": "Place the bishop on the same diagonal as the knight and the king.",
    "explanation": "Bishop to a2 pins the knight to the king and attacks it. The knight cannot move off the diagonal, so it is lost."
  },
  {
    "id": "pn-04",
    "title": "Absolute pin on the file",
    "theme": "pin",
    "difficulty": 3,
    "rating": 1400,
    "fen": "3k4/3q4/8/8/8/8/8/3RK3 w - - 0 1",
    "solution": [
      "d1d7"
    ],
    "hint": "The queen cannot leave the file without exposing the king.",
    "explanation": "The queen is pinned to the king on the d-file. The rook captures the queen, winning a queen for a rook after the king recaptures."
  },
  {
    "id": "pr-20",
    "title": "Promote to a queen",
    "theme": "promotion",
    "difficulty": 1,
    "rating": 900,
    "fen": "8/4P3/8/8/8/8/8/4K1k1 w - - 0 1",
    "solution": [
      "e7e8q"
    ],
    "hint": "Advance the pawn to the eighth rank.",
    "explanation": "Promoting to a queen creates a decisive material advantage."
  },
  {
    "id": "pr-01",
    "title": "Promote to a queen",
    "theme": "promotion",
    "difficulty": 2,
    "rating": 1100,
    "fen": "8/4P1k1/8/8/8/8/8/4K3 w - - 0 1",
    "solution": [
      "e7e8q"
    ],
    "hint": "Advance the pawn to the eighth rank and promote it.",
    "explanation": "Pawn to e8 promotes to a queen and gives White a decisive material advantage. The promotion does not deliver immediate checkmate."
  },
  {
    "id": "pr-03",
    "title": "Queening wins the race",
    "theme": "promotion",
    "difficulty": 2,
    "rating": 1100,
    "fen": "8/6P1/8/8/8/8/2k5/4K3 w - - 0 1",
    "solution": [
      "g7g8q"
    ],
    "hint": "Promote before the enemy king can stop the pawn.",
    "explanation": "Pawn to g8 equals a new queen and a winning endgame."
  },
  {
    "id": "pr-04",
    "title": "Promotion with capture",
    "theme": "promotion",
    "difficulty": 2,
    "rating": 1100,
    "fen": "5n2/4P3/8/8/8/8/8/4K1k1 w - - 0 1",
    "solution": [
      "e7f8q"
    ],
    "hint": "Capture on the promotion square if needed.",
    "explanation": "Taking the knight with promotion creates a decisive queen."
  },
  {
    "id": "pr-02",
    "title": "Promote with a capture",
    "theme": "promotion",
    "difficulty": 4,
    "rating": 1700,
    "fen": "5r1k/4P1p1/7p/8/8/8/8/4R1K1 w - - 0 1",
    "solution": [
      "e7f8q"
    ],
    "hint": "Capture on the promotion square to create a new queen with check.",
    "explanation": "The pawn captures the rook on f8 and promotes to a queen, giving check and winning a rook."
  },
  {
    "id": "pr-22",
    "title": "Knight underpromotion to force mate",
    "theme": "promotion",
    "difficulty": 4,
    "rating": 1850,
    "fen": "5N2/1p2R1P1/2b4k/8/5K2/8/8/q5r1 w - - 0 1",
    "solution": [
      "g7g8n",
      "g1g8",
      "e7h7"
    ],
    "hint": "A queen promotion would not give the check that is needed. Promote to a knight.",
    "explanation": "The pawn promotes to a knight and checks the king. After the rook captures the knight, the white rook mates on h7. Promoting to a queen or rook would not produce this mating sequence.",
    "source": "lichess:0UGkT"
  },
  {
    "id": "sc-22",
    "title": "Queen sacrifice on the d-file",
    "theme": "sacrifice",
    "difficulty": 3,
    "rating": 1500,
    "fen": "r5k1/5ppp/8/8/8/8/3Q1PPP/3R2K1 w - - 0 1",
    "solution": [
      "d2d8",
      "a8d8",
      "d1d8"
    ],
    "hint": "Offer the queen on the back rank, then recapture with the rook.",
    "explanation": "Queen to d8 checks the king and is captured by the black rook. The white rook recaptures on d8 and mates because the black pawns block their king."
  },
  {
    "id": "sc-01",
    "title": "Queen sacrifice for back-rank mate",
    "theme": "sacrifice",
    "difficulty": 4,
    "rating": 1700,
    "fen": "3r2k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1",
    "solution": [
      "e2e8",
      "d8e8",
      "e1e8"
    ],
    "hint": "Give the queen on the back rank so that the rook can recapture with mate.",
    "explanation": "Queen to e8 checks the king and is captured by the defending rook. The white rook then recaptures on e8 and mates on the back rank."
  },
  {
    "id": "sk-02",
    "title": "Bishop skewer on the long diagonal",
    "theme": "skewer",
    "difficulty": 2,
    "rating": 1100,
    "fen": "7q/6k1/8/8/8/8/8/2B3K1 w - - 0 1",
    "solution": [
      "c1b2"
    ],
    "hint": "Check the king so that the queen behind it is exposed.",
    "explanation": "Bishop to b2 checks the king on g7, and the queen on h8 lies behind the king on the same diagonal. After the king moves, the bishop wins the queen."
  },
  {
    "id": "sk-03",
    "title": "Rook skewer on the back rank",
    "theme": "skewer",
    "difficulty": 2,
    "rating": 1100,
    "fen": "q3k3/8/8/8/8/8/8/4K2R w - - 0 1",
    "solution": [
      "h1h8"
    ],
    "hint": "Check on the eighth rank, where the queen sits behind the king.",
    "explanation": "Rook to h8 checks the king, and the queen on a8 is behind the king on the same rank. After the king moves, the rook wins the queen."
  },
  {
    "id": "zg-20",
    "title": "Opposition zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 3,
    "rating": 1500,
    "fen": "8/8/8/8/3k4/8/3P4/3K4 w - - 0 1",
    "solution": [
      "d1e2"
    ],
    "hint": "Approach with the king on either side of the pawn.",
    "explanation": "King to e2 or c2 takes the opposition. Black must give ground, and the pawn can then advance.",
    "alternatives": [
      [
        "d1e2",
        "d1c2"
      ]
    ]
  },
  {
    "id": "zg-21",
    "title": "Zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 4,
    "rating": 2093,
    "fen": "8/p7/1p2k3/1Pp3pp/2P3p1/4KP1P/P7/8 w - - 0 1",
    "solution": [
      "f3g4",
      "h5g4",
      "h3g4",
      "e6e5",
      "a2a3"
    ],
    "hint": "A quiet move can leave the opponent with no useful reply.",
    "explanation": "The solution begins with fxg4. The quiet or forcing continuation leaves the opponent with no useful reply. The main line is fxg4 hxg4 hxg4 Ke5 a3, which keeps a decisive advantage for White.",
    "source": "lichess:05lpo"
  },
  {
    "id": "zg-22",
    "title": "Zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 5,
    "rating": 2283,
    "fen": "8/5ppp/8/5KPP/5P2/5k2/8/8 w - - 0 1",
    "solution": [
      "h5h6",
      "g7h6",
      "g5h6",
      "f3g3",
      "f5g5"
    ],
    "hint": "A quiet move can leave the opponent with no useful reply.",
    "explanation": "The solution begins with h6. The quiet or forcing continuation leaves the opponent with no useful reply. The main line is h6 gxh6 gxh6 Kg3 Kg5, which keeps a decisive advantage for White.",
    "source": "lichess:019vo"
  },
  {
    "id": "ds-31",
    "title": "Discovered check wins the queen",
    "theme": "discovered",
    "difficulty": 3,
    "rating": 1500,
    "fen": "4q2k/8/8/8/4B3/8/8/4R1K1 w - - 0 1",
    "solution": [
      "e4h7"
    ],
    "hint": "Move the bishop so that it checks the king and uncovers an attack on the queen.",
    "explanation": "Bishop to h7 checks the king and uncovers the rook on e1, which attacks the queen on e8. Black cannot save both the king and the queen."
  },
  {
    "id": "eg-31",
    "title": "Mate in three",
    "theme": "mate-in-3",
    "difficulty": 5,
    "rating": 2100,
    "fen": "Q7/8/3B4/2p5/1rkn4/K7/8/8 b - - 0 1",
    "solution": [
      "d4b5",
      "a3a2",
      "b5c3",
      "a2a1",
      "b4b1"
    ],
    "hint": "Look for a forcing sequence that mates on the third move.",
    "explanation": "The solution begins with Nb5+. The forced line is Nb5+ Ka2 Nc3+ Ka1 Rb1#, ending in checkmate.",
    "source": "lichess:00dt1"
  },
  {
    "id": "li-03M6W",
    "title": "Mate in three",
    "theme": "mate-in-3",
    "difficulty": 4,
    "rating": 2030,
    "fen": "7k/ppp3rr/1b1p4/4pQ2/4P1q1/P2P2B1/1PP1RP1P/R5K1 b - - 0 1",
    "solution": [
      "g4g3",
      "h2g3",
      "g7g3",
      "g1f1",
      "h7h1"
    ],
    "hint": "Look for a forcing sequence that mates on the third move.",
    "explanation": "The solution begins with Qxg3+. The forced line is Qxg3+ hxg3 Rxg3+ Kf1 Rh1#, ending in checkmate.",
    "source": "lichess:03M6W"
  },
  {
    "id": "li-01oma",
    "title": "Mate in three",
    "theme": "mate-in-3",
    "difficulty": 4,
    "rating": 2024,
    "fen": "r4q1k/1p4pp/1n2Q1pN/p3P3/Pbp1P3/8/1P2p1PP/5RK1 w - - 0 1",
    "solution": [
      "f1f8",
      "a8f8",
      "e6g8",
      "f8g8",
      "h6f7"
    ],
    "hint": "Look for a forcing sequence that mates on the third move.",
    "explanation": "The solution begins with Rxf8+. The forced line is Rxf8+ Rxf8 Qg8+ Rxg8 Nf7#, ending in checkmate.",
    "source": "lichess:01oma"
  },
  {
    "id": "li-0556F",
    "title": "Mate in three",
    "theme": "mate-in-3",
    "difficulty": 5,
    "rating": 2144,
    "fen": "5rk1/5ppb/1pN5/3P1P1P/1PP1n3/4q2P/rQK5/5BR1 w - - 0 1",
    "solution": [
      "g1g7",
      "g8h8",
      "g7g8",
      "h8g8",
      "c6e7"
    ],
    "hint": "Look for a forcing sequence that mates on the third move.",
    "explanation": "The solution begins with Rxg7+. The forced line is Rxg7+ Kh8 Rg8+ Kxg8 Ne7#, ending in checkmate.",
    "source": "lichess:0556F"
  },
  {
    "id": "li-06fhB",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1967,
    "fen": "8/r7/5kP1/7P/3K4/8/2p5/4R3 b - - 0 1",
    "solution": [
      "a7d7",
      "d4c3",
      "d7d1",
      "e1e6",
      "f6e6"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Rd7+. The main line is Rd7+ Kc3 Rd1 Re6+ Kxe6, which keeps a decisive advantage for Black.",
    "source": "lichess:06fhB"
  },
  {
    "id": "li-01FAd",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2300,
    "fen": "8/8/8/7P/3R1pk1/1r6/6K1/8 b - - 0 1",
    "solution": [
      "b3b2",
      "g2f1",
      "g4g3",
      "d4d6",
      "b2b1",
      "f1e2",
      "f4f3",
      "e2e3",
      "b1e1"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Rb2+. The main line is Rb2+ Kf1 Kg3 Rd6 Rb1+ Ke2 f3+ Ke3 Re1+, which keeps a decisive advantage for Black.",
    "source": "lichess:01FAd"
  },
  {
    "id": "li-07Al6",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 2018,
    "fen": "8/8/R2bpk2/2p1p2p/1pP1P2P/1P1N1P2/4K1r1/8 w - - 0 1",
    "solution": [
      "e2f1",
      "g2d2",
      "a6d6",
      "f6e7",
      "f1e1"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Kf1. The main line is Kf1 Rd2 Rxd6 Ke7 Ke1, which keeps a decisive advantage for White.",
    "source": "lichess:07Al6"
  },
  {
    "id": "li-030R2",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1947,
    "fen": "8/8/6k1/7p/1rR2Pp1/3K2P1/8/8 b - - 0 1",
    "solution": [
      "b4c4",
      "d3c4",
      "h5h4",
      "g3h4",
      "g4g3"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Rxc4. The main line is Rxc4 Kxc4 h4 gxh4 g3, which keeps a decisive advantage for Black.",
    "source": "lichess:030R2"
  },
  {
    "id": "li-04MWF",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1924,
    "fen": "8/1Pk5/6p1/3K3p/pP3p2/2P5/P5P1/8 b - - 0 1",
    "solution": [
      "f4f3",
      "b7b8q",
      "c7b8",
      "g2f3",
      "h5h4"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with f3. The main line is f3 b8=Q+ Kxb8 gxf3 h4, which keeps a decisive advantage for Black.",
    "source": "lichess:04MWF"
  },
  {
    "id": "li-01Amj",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1920,
    "fen": "8/8/8/2p1K3/p7/1k6/8/2B5 b - - 0 1",
    "solution": [
      "a4a3",
      "c1a3",
      "b3a3",
      "e5d5",
      "a3b4"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with a3. The main line is a3 Bxa3 Kxa3 Kd5 Kb4, which keeps a decisive advantage for Black.",
    "source": "lichess:01Amj"
  },
  {
    "id": "li-03HqP",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 2057,
    "fen": "8/4Qpkp/2B2np1/pp3pb1/5q2/2P2P2/PP3PK1/4R3 b - - 0 1",
    "solution": [
      "f6g4",
      "e7c5",
      "f4h2",
      "g2f1",
      "g5e3"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Ng4. The main line is Ng4 Qc5 Qh2+ Kf1 Be3, which keeps a decisive advantage for Black.",
    "source": "lichess:03HqP"
  },
  {
    "id": "li-04rB1",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 5,
    "rating": 2132,
    "fen": "8/1r6/N7/1BP1k2p/1K3pp1/8/6PP/8 b - - 0 1",
    "solution": [
      "f4f3",
      "c5c6",
      "b7b5",
      "b4b5",
      "f3f2",
      "b5b6",
      "f2f1q"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with f3. The first move gives up material in order to force the continuation. The main line is f3 c6 Rxb5+ Kxb5 f2 Kb6 f1=Q, which keeps a decisive advantage for Black.",
    "source": "lichess:04rB1"
  },
  {
    "id": "li-03fg8",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1962,
    "fen": "8/8/8/2p5/3k1K1p/3P2PP/8/8 b - - 0 1",
    "solution": [
      "d4d3",
      "g3h4",
      "c5c4",
      "h4h5",
      "c4c3",
      "h5h6",
      "c3c2",
      "f4f5",
      "c2c1q"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Kxd3. The main line is Kxd3 gxh4 c4 h5 c3 h6 c2 Kf5 c1=Q, which keeps a decisive advantage for Black.",
    "source": "lichess:03fg8"
  },
  {
    "id": "li-01WwV",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1909,
    "fen": "8/8/3K4/4Pk2/p7/1pP5/1P6/8 b - - 0 1",
    "solution": [
      "a4a3",
      "e5e6",
      "a3b2",
      "e6e7",
      "b2b1q"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with a3. The main line is a3 e6 axb2 e7 b1=Q, which keeps a decisive advantage for Black.",
    "source": "lichess:01WwV"
  },
  {
    "id": "li-05g7S",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 2027,
    "fen": "8/1p2Pk2/p1p5/P4NP1/1P1p1K2/3P4/8/5r2 w - - 0 1",
    "solution": [
      "f4e5",
      "f1g1",
      "e5d6",
      "g1g5",
      "d6d7",
      "g5f5",
      "e7e8q"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Ke5. The main line is Ke5 Rg1 Kd6 Rxg5 Kd7 Rxf5 e8=Q+, which keeps a decisive advantage for White.",
    "source": "lichess:05g7S"
  },
  {
    "id": "li-04M0U",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 5,
    "rating": 2236,
    "fen": "3r3k/1p3p2/p5qp/5p2/5r2/1P4NP/P5P1/R3Q2K w - - 0 1",
    "solution": [
      "e1e5",
      "g6g7",
      "e5g7",
      "h8g7",
      "g3h5",
      "g7g6",
      "h5f4"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Qe5+. The moving piece forks the pawn and king and rook. The main line is Qe5+ Qg7 Qxg7+ Kxg7 Nh5+ Kg6 Nxf4+, which keeps a decisive advantage for White.",
    "source": "lichess:04M0U"
  },
  {
    "id": "li-043eX",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 1908,
    "fen": "2bk4/p2r2Qp/1p1p4/2pP4/2P2p1q/1P1P4/PB4B1/6K1 w - - 0 1",
    "solution": [
      "b2f6",
      "d8c7",
      "g7d7",
      "c8d7",
      "f6h4"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Bf6+. The moving piece forks the queen and king. The main line is Bf6+ Kc7 Qxd7+ Bxd7 Bxh4, which keeps a decisive advantage for White.",
    "source": "lichess:043eX"
  },
  {
    "id": "li-01xmi",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 1944,
    "fen": "r1bqk2r/pp3ppp/4p1n1/2bnP3/8/3B1N2/PP2QPPP/RNB2RK1 w kq - 0 1",
    "solution": [
      "d3g6",
      "f7g6",
      "e2b5",
      "c8d7",
      "b5c5"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Bxg6. The moving piece forks the pawn. The main line is Bxg6 fxg6 Qb5+ Bd7 Qxc5, which keeps a decisive advantage for White.",
    "source": "lichess:01xmi"
  },
  {
    "id": "li-06V6c",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 1995,
    "fen": "r1b2rk1/ppq4p/2n1pbp1/3pN3/3P4/2NBQ3/PP3PPP/R3R1K1 b - - 0 1",
    "solution": [
      "f6e5",
      "d4e5",
      "d5d4",
      "e3g3",
      "d4c3"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Bxe5. The moving piece forks the pawn. The main line is Bxe5 dxe5 d4 Qg3 dxc3, which keeps a decisive advantage for Black.",
    "source": "lichess:06V6c"
  },
  {
    "id": "li-04DmI",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 5,
    "rating": 2133,
    "fen": "4k3/pbp1r3/1p3qnQ/4P1N1/2Pn4/8/PP4PP/R4RK1 b - - 0 1",
    "solution": [
      "d4e2",
      "g1h1",
      "b7g2",
      "h1g2",
      "g6f4"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Ne2+. The first move gives up material in order to force the continuation. The main line is Ne2+ Kh1 Bxg2+ Kxg2 Ngf4+, which keeps a decisive advantage for Black.",
    "source": "lichess:04DmI"
  },
  {
    "id": "li-005f3",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 4,
    "rating": 2080,
    "fen": "r5k1/2p1pp2/pp4p1/1q5r/5P2/2QP2R1/PP6/1K4R1 w - - 0 1",
    "solution": [
      "g3g6",
      "f7g6",
      "g1g6",
      "g8f7",
      "c3g7",
      "f7e8",
      "g7g8",
      "e8d7",
      "g8e6",
      "d7d8",
      "g6g8"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Rxg6+. The first move gives up material in order to force the continuation. The main line is Rxg6+ fxg6 Rxg6+ Kf7 Qg7+ Ke8 Qg8+ Kd7 Qe6+ Kd8 Rg8+, which keeps a decisive advantage for White.",
    "source": "lichess:005f3"
  },
  {
    "id": "li-06com",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 4,
    "rating": 1948,
    "fen": "r4rk1/1p3pp1/2p2q1p/p7/6Q1/1PbRB2P/P4PP1/5RK1 w - a6 0 1",
    "solution": [
      "d3c3",
      "f6c3",
      "e3d4",
      "c3d4",
      "g4d4"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Rxc3. The first move gives up material in order to force the continuation. The main line is Rxc3 Qxc3 Bd4 Qxd4 Qxd4, which keeps a decisive advantage for White.",
    "source": "lichess:06com"
  },
  {
    "id": "li-03fz5",
    "title": "Skewer",
    "theme": "skewer",
    "difficulty": 4,
    "rating": 1919,
    "fen": "8/p1bqr1kp/5pp1/2PB4/3QNP1P/6Pb/P1R4K/8 b - - 0 1",
    "solution": [
      "e7e4",
      "d4e4",
      "h3f5",
      "e4c4",
      "f5c2",
      "c4c2",
      "d7d5"
    ],
    "hint": "Check through a valuable piece so that the piece behind it is exposed.",
    "explanation": "The solution begins with Rxe4. The first move skewers a more valuable piece and leaves the piece behind it exposed. The main line is Rxe4 Qxe4 Bf5 Qc4 Bxc2 Qxc2 Qxd5, which keeps a decisive advantage for Black.",
    "source": "lichess:03fz5"
  },
  {
    "id": "li-026QC",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 4,
    "rating": 2091,
    "fen": "8/R1r5/1p5p/1kq1pr2/1N1p4/P2P1p2/1PP4P/2K2Q2 w - - 0 1",
    "solution": [
      "a3a4",
      "b5b4",
      "f1e1",
      "c5c3",
      "b2c3"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with a4+. The first move gives up material in order to force the continuation. The main line is a4+ Kxb4 Qe1+ Qc3 bxc3+, which keeps a decisive advantage for White.",
    "source": "lichess:026QC"
  },
  {
    "id": "li-01kad",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 5,
    "rating": 2197,
    "fen": "1r5k/p4q1p/2Q2p2/4pN2/Pr2P3/1P1n3P/K1P2P2/1R5R b - - 0 1",
    "solution": [
      "b4b3",
      "b1b3",
      "d3b4",
      "a2b1",
      "b4c6",
      "b3b8",
      "c6b8"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Rxb3. The first move gives up material in order to force the continuation. The main line is Rxb3 Rxb3 Nb4+ Kb1 Nxc6 Rxb8+ Nxb8, which keeps a decisive advantage for Black.",
    "source": "lichess:01kad"
  },
  {
    "id": "li-013U2",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 5,
    "rating": 2199,
    "fen": "r1bn1k2/p2pbP2/1p4pr/1P5p/2B5/P1B3N1/2P3PP/1K2R3 w - - 0 1",
    "solution": [
      "e1e7",
      "f8e7",
      "c3b4",
      "d7d6",
      "b4d6"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Rxe7. The first move gives up material in order to force the continuation. The main line is Rxe7 Kxe7 Bb4+ d6 Bxd6+, which keeps a decisive advantage for White.",
    "source": "lichess:013U2"
  },
  {
    "id": "li-02Nig",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1987,
    "fen": "1Q6/1p6/2p3p1/5r2/p1P2k2/4b3/PP6/7K b - - 0 1",
    "solution": [
      "f4f3",
      "b8h2",
      "f5h5",
      "h2h5",
      "g6h5"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Kf3. The main line is Kf3 Qh2 Rh5 Qxh5+ gxh5, which keeps a decisive advantage for Black.",
    "source": "lichess:02Nig"
  },
  {
    "id": "li-06XtR",
    "title": "Pin",
    "theme": "pin",
    "difficulty": 4,
    "rating": 1987,
    "fen": "1r6/3q1k2/3P3p/3R1P2/8/1p3KP1/1Q4P1/8 b - - 0 1",
    "solution": [
      "d7c6",
      "b2e5",
      "b8e8",
      "e5d4",
      "b3b2"
    ],
    "hint": "A piece cannot move without exposing a more valuable piece behind it.",
    "explanation": "The solution begins with Qc6. The first move creates or exploits a pin. The main line is Qc6 Qe5 Re8 Qd4 b2, which keeps a decisive advantage for Black.",
    "source": "lichess:06XtR"
  },
  {
    "id": "li-066yl",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2265,
    "fen": "r7/1p1kn1Q1/p2Np2p/3pP3/3q4/8/P5PP/5R1K w - - 0 1",
    "solution": [
      "d6f5",
      "d4c5",
      "f5e7",
      "c5e7",
      "f1f7"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Nf5. The main line is Nf5 Qc5 Nxe7 Qxe7 Rf7, which keeps a decisive advantage for White.",
    "source": "lichess:066yl"
  },
  {
    "id": "li-03JWQ",
    "title": "Quiet pin",
    "theme": "pin",
    "difficulty": 5,
    "rating": 2300,
    "fen": "2r3k1/4Bpbp/6p1/4P3/3P4/6P1/4bqBP/Q3R2K b - - 0 1",
    "solution": [
      "e2f3",
      "e1g1",
      "c8c2",
      "a1f1",
      "f2f1",
      "g1f1",
      "f3g2"
    ],
    "hint": "A piece cannot move without exposing a more valuable piece behind it.",
    "explanation": "The solution begins with Bf3. The first move creates or exploits a pin. The main line is Bf3 Rg1 Rc2 Qf1 Qxf1 Rxf1 Bxg2+, which keeps a decisive advantage for Black.",
    "source": "lichess:03JWQ"
  },
  {
    "id": "li-03U1f",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 1995,
    "fen": "1k2r3/p2p4/1p1q2p1/3br1B1/Q6P/1P4P1/P7/R3R1K1 w - - 0 1",
    "solution": [
      "e1e5",
      "e8e5",
      "g5f4",
      "d6c5",
      "g1f1"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Rxe5. The moving piece forks the bishop and rook. The main line is Rxe5 Rxe5 Bf4 Qc5+ Kf1, which keeps a decisive advantage for White.",
    "source": "lichess:03U1f"
  },
  {
    "id": "li-04tyQ",
    "title": "Discovered attack",
    "theme": "discovered",
    "difficulty": 4,
    "rating": 1982,
    "fen": "3qk1nr/p2rbpp1/1p2p2p/1Np1P2Q/2Pn4/1P2B1PN/P4P1P/3R1RK1 b k - 0 1",
    "solution": [
      "g7g6",
      "h5g4",
      "h6h5",
      "g4e4",
      "d4e2",
      "g1g2",
      "d7d1",
      "f1d1",
      "d8d1"
    ],
    "hint": "Move one piece so that another piece behind it gives an attack.",
    "explanation": "The solution begins with g6. The first move uncovers an attack from a piece standing behind it. The main line is g6 Qg4 h5 Qe4 Ne2+ Kg2 Rxd1 Rxd1 Qxd1, which keeps a decisive advantage for Black.",
    "source": "lichess:04tyQ"
  },
  {
    "id": "li-03Oqv",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 1904,
    "fen": "r3kn1R/p4pp1/2n1p3/1N1p2q1/1ppPPN2/5P2/PPPQ4/2K5 w q - 0 1",
    "solution": [
      "h8f8",
      "e8f8",
      "f4e6",
      "f7e6",
      "d2g5"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Rxf8+. The moving piece forks the king and pawn. The main line is Rxf8+ Kxf8 Nxe6+ fxe6 Qxg5, which keeps a decisive advantage for White.",
    "source": "lichess:03Oqv"
  },
  {
    "id": "li-04DZk",
    "title": "Sacrifice",
    "theme": "sacrifice",
    "difficulty": 4,
    "rating": 1944,
    "fen": "r3kb1r/pbp1p1pp/1pn2n2/3qNp2/2QP4/6P1/PP2PPBP/RNB2RK1 b kq - 0 1",
    "solution": [
      "d5g2",
      "g1g2",
      "c6e5",
      "g2g1",
      "e5c4"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Qxg2+. The first move gives up material in order to force the continuation. The main line is Qxg2+ Kxg2 Nxe5+ Kg1 Nxc4, which keeps a decisive advantage for Black.",
    "source": "lichess:04DZk"
  },
  {
    "id": "li-00vUf",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2159,
    "fen": "3R4/p4p1p/2p3k1/6p1/1P1B4/r3PP2/2r3PP/5K2 w - - 0 1",
    "solution": [
      "d8d6",
      "f7f6",
      "d6f6",
      "g6g7",
      "f6c6"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Rd6+. The main line is Rd6+ f6 Rxf6+ Kg7 Rxc6+, which keeps a decisive advantage for White.",
    "source": "lichess:00vUf"
  },
  {
    "id": "li-01JlU",
    "title": "Deflection",
    "theme": "deflection",
    "difficulty": 5,
    "rating": 2177,
    "fen": "4r2r/p1Q2pk1/1pp3p1/6q1/2BP2P1/8/PP2N1R1/6K1 b - - 0 1",
    "solution": [
      "g5e3",
      "g2f2",
      "h8h1",
      "g1h1",
      "e3f2",
      "c7f7",
      "f2f7"
    ],
    "hint": "Force a defending piece away from a key square.",
    "explanation": "The solution begins with Qe3+. The first move forces a defending piece away from a key square or duty. The main line is Qe3+ Rf2 Rh1+ Kxh1 Qxf2 Qxf7+ Qxf7, which keeps a decisive advantage for Black.",
    "source": "lichess:01JlU"
  },
  {
    "id": "li-04ACF",
    "title": "Deflection",
    "theme": "deflection",
    "difficulty": 5,
    "rating": 2289,
    "fen": "r4rk1/ppbb2pp/2p1p3/2Pp4/3Pp3/2N1P3/PPQ1B1PP/R1B1qRK1 b - - 0 1",
    "solution": [
      "f8f1",
      "e2f1",
      "a8f8",
      "c2e2",
      "f8f1",
      "e2f1",
      "c7h2",
      "g1h2",
      "e1f1"
    ],
    "hint": "Force a defending piece away from a key square.",
    "explanation": "The solution begins with Rxf1+. The first move forces a defending piece away from a key square or duty. The main line is Rxf1+ Bxf1 Rf8 Qe2 Rxf1+ Qxf1 Bxh2+ Kxh2 Qxf1, which keeps a decisive advantage for Black.",
    "source": "lichess:04ACF"
  },
  {
    "id": "li-00LZl",
    "title": "Fork",
    "theme": "fork",
    "difficulty": 5,
    "rating": 2262,
    "fen": "r2qk2r/ppp2ppp/2n5/3pPb2/1b1n1B2/2NB1N2/PP3PPP/R2QK2R w KQkq - 0 1",
    "solution": [
      "f3d4",
      "c6d4",
      "d1a4",
      "d4c6",
      "d3f5"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Nxd4. The moving piece forks the bishop and knight. The main line is Nxd4 Nxd4 Qa4+ Nc6 Bxf5, which keeps a decisive advantage for White.",
    "source": "lichess:00LZl"
  },
  {
    "id": "li-00DZe",
    "title": "Deflection",
    "theme": "deflection",
    "difficulty": 5,
    "rating": 2300,
    "fen": "8/5k2/7p/p1P1bPpP/Pp2P3/1P1p1K2/5B2/8 b - - 0 1",
    "solution": [
      "g5g4",
      "f3e3",
      "e5d4",
      "e3d3",
      "d4f2"
    ],
    "hint": "Force a defending piece away from a key square.",
    "explanation": "The solution begins with g4+. The first move forces a defending piece away from a key square or duty. The main line is g4+ Ke3 Bd4+ Kxd3 Bxf2, which keeps a decisive advantage for Black.",
    "source": "lichess:00DZe"
  },
  {
    "id": "li-05VnQ",
    "title": "Zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 5,
    "rating": 2300,
    "fen": "8/8/pp1p1k1p/2pP2p1/2P3P1/1P2K2P/P7/8 b - - 0 1",
    "solution": [
      "f6e5",
      "a2a3",
      "b6b5",
      "e3d3",
      "b5c4"
    ],
    "hint": "A quiet move can leave the opponent with no useful reply.",
    "explanation": "The solution begins with Ke5. The quiet or forcing continuation leaves the opponent with no useful reply. The main line is Ke5 a3 b5 Kd3 bxc4+, which keeps a decisive advantage for Black.",
    "source": "lichess:05VnQ"
  },
  {
    "id": "li-06avE",
    "title": "Zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 4,
    "rating": 2098,
    "fen": "8/1p3p2/3kpPp1/P1p4p/2P1K1P1/5P2/7P/8 b - g3 0 1",
    "solution": [
      "h5g4",
      "f3g4",
      "g6g5",
      "e4d3",
      "d6e5",
      "d3e3",
      "e5f6"
    ],
    "hint": "A quiet move can leave the opponent with no useful reply.",
    "explanation": "The solution begins with hxg4. The quiet or forcing continuation leaves the opponent with no useful reply. The main line is hxg4 fxg4 g5 Kd3 Ke5 Ke3 Kxf6, which keeps a decisive advantage for Black.",
    "source": "lichess:06avE"
  },
  {
    "id": "li-05P2i",
    "title": "Zugzwang",
    "theme": "zugzwang-ish",
    "difficulty": 4,
    "rating": 1908,
    "fen": "8/3k2p1/1p1Np2p/1P2PnPP/8/5K2/8/8 w - - 0 1",
    "solution": [
      "d6f5",
      "e6f5",
      "f3f4",
      "d7e6",
      "g5g6",
      "e6e7",
      "f4f5"
    ],
    "hint": "A quiet move can leave the opponent with no useful reply.",
    "explanation": "The solution begins with Nxf5. The quiet or forcing continuation leaves the opponent with no useful reply. The main line is Nxf5 exf5 Kf4 Ke6 g6 Ke7 Kxf5, which keeps a decisive advantage for White.",
    "source": "lichess:05P2i"
  },
  {
    "id": "li-00K7b",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1977,
    "fen": "7k/1p4p1/pP1r4/4qp2/P2Nn3/1Q5P/2N5/3R1K2 b - - 0 1",
    "solution": [
      "e5f4",
      "b3f3",
      "f4f3",
      "d4f3",
      "d6d1"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Qf4+. The main line is Qf4+ Qf3 Qxf3+ Nxf3 Rxd1+, which keeps a decisive advantage for Black.",
    "source": "lichess:00K7b"
  },
  {
    "id": "li-05cEL",
    "title": "Discovered attack",
    "theme": "discovered",
    "difficulty": 5,
    "rating": 2300,
    "fen": "3r2k1/5p1p/2q2bp1/2Npp3/pPQ5/4PB1P/5PP1/3R2K1 b - - 0 1",
    "solution": [
      "d5c4",
      "d1d8",
      "f6d8",
      "f3c6",
      "a4a3",
      "c6b5",
      "a3a2"
    ],
    "hint": "Move one piece so that another piece behind it gives an attack.",
    "explanation": "The solution begins with dxc4. The first move uncovers an attack from a piece standing behind it. The main line is dxc4 Rxd8+ Bxd8 Bxc6 a3 Bb5 a2, which keeps a decisive advantage for Black.",
    "source": "lichess:05cEL"
  },
  {
    "id": "li-05qT7",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 2002,
    "fen": "r5k1/5pp1/1pP4p/3p4/p2P4/R3P2P/5PP1/5K2 b - - 0 1",
    "solution": [
      "b6b5",
      "c6c7",
      "a8c8",
      "f1e2",
      "c8c7"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with b5. The main line is b5 c7 Rc8 Ke2 Rxc7, which keeps a decisive advantage for Black.",
    "source": "lichess:05qT7"
  },
  {
    "id": "li-04jT2",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2116,
    "fen": "8/8/p1k5/Pp6/3Pp1p1/4P1P1/3K4/8 b - - 0 1",
    "solution": [
      "b5b4",
      "d2c2",
      "c6b5",
      "d4d5",
      "b5a5"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with b4. The main line is b4 Kc2 Kb5 d5 Kxa5, which keeps a decisive advantage for Black.",
    "source": "lichess:04jT2"
  },
  {
    "id": "li-03RZV",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 1944,
    "fen": "8/8/6p1/K1pP1k2/2P5/8/8/8 b - - 0 1",
    "solution": [
      "f5e5",
      "a5b5",
      "e5d6",
      "b5a4",
      "g6g5",
      "a4b3",
      "g5g4"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Ke5. The main line is Ke5 Kb5 Kd6 Ka4 g5 Kb3 g4, which keeps a decisive advantage for Black.",
    "source": "lichess:03RZV"
  },
  {
    "id": "li-05Sdi",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2213,
    "fen": "r4r2/p1Pq1bkp/1p1N4/3Qp3/6pP/6P1/PP6/2R3K1 w - - 0 1",
    "solution": [
      "d5e5",
      "g7g8",
      "d6f5",
      "d7f5",
      "e5f5"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Qxe5+. The main line is Qxe5+ Kg8 Nf5 Qxf5 Qxf5, which keeps a decisive advantage for White.",
    "source": "lichess:05Sdi"
  },
  {
    "id": "li-00pWF",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2280,
    "fen": "8/8/p3k3/1p1pP3/5P2/1P3K2/8/8 b - - 0 1",
    "solution": [
      "a6a5",
      "f3e3",
      "a5a4",
      "b3a4",
      "b5a4",
      "e3d4",
      "a4a3",
      "d4c3",
      "d5d4",
      "c3d4",
      "a3a2"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with a5. The main line is a5 Ke3 a4 bxa4 bxa4 Kd4 a3 Kc3 d4+ Kxd4 a2, which keeps a decisive advantage for Black.",
    "source": "lichess:00pWF"
  },
  {
    "id": "li-05WHF",
    "title": "Quiet endgame continuation",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2101,
    "fen": "8/8/3P4/1b4K1/2k1p1P1/4P3/8/8 w - - 0 1",
    "solution": [
      "g5f6",
      "c4d3",
      "g4g5",
      "d3e3",
      "g5g6",
      "e3f2",
      "g6g7"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Kf6. The main line is Kf6 Kd3 g5 Kxe3 g6 Kf2 g7, which keeps a decisive advantage for White.",
    "source": "lichess:05WHF"
  },
  {
    "id": "li-06o2P",
    "title": "Mate in four",
    "theme": "mate-in-4",
    "difficulty": 4,
    "rating": 2029,
    "fen": "5r2/p5R1/2pp1r1k/4bP2/8/2PB2p1/PP3pP1/3K1R2 w - - 0 1",
    "solution": [
      "g7g4",
      "h6h7",
      "f1h1",
      "f6h6",
      "f5f6",
      "h7h8",
      "h1h6"
    ],
    "hint": "Look for a forcing sequence that mates on the fourth move.",
    "explanation": "The solution begins with Rg4. The forced line is Rg4 Kh7 Rh1+ Rh6 f6+ Kh8 Rxh6#, ending in checkmate.",
    "source": "lichess:06o2P"
  },
  {
    "id": "li-062e9",
    "title": "Mate in four",
    "theme": "mate-in-4",
    "difficulty": 5,
    "rating": 2113,
    "fen": "8/4R1pp/5pk1/1p1b4/2p2PPP/8/2r2B2/6K1 w - - 0 1",
    "solution": [
      "f4f5",
      "g6h6",
      "f2e3",
      "g7g5",
      "f5g6",
      "h6g6",
      "h4h5"
    ],
    "hint": "Look for a forcing sequence that mates on the fourth move.",
    "explanation": "The solution begins with f5+. The forced line is f5+ Kh6 Be3+ g5 fxg6+ Kxg6 h5#, ending in checkmate.",
    "source": "lichess:062e9"
  },
  {
    "id": "li-06LQW",
    "title": "Mate in four",
    "theme": "mate-in-4",
    "difficulty": 5,
    "rating": 2300,
    "fen": "r4Bk1/pp3p2/7p/3N2p1/2BpPbbq/2P5/PPQ3P1/R3R1K1 b - - 0 1",
    "solution": [
      "h4h2",
      "g1f1",
      "h2h1",
      "f1f2",
      "f4g3",
      "f2g3",
      "h1h4"
    ],
    "hint": "Look for a forcing sequence that mates on the fourth move.",
    "explanation": "The solution begins with Qh2+. The forced line is Qh2+ Kf1 Qh1+ Kf2 Bg3+ Kxg3 Qh4#, ending in checkmate.",
    "source": "lichess:06LQW"
  },
  {
    "id": "li-00LRq",
    "title": "Mate in four",
    "theme": "mate-in-4",
    "difficulty": 5,
    "rating": 2219,
    "fen": "1k6/1p1q2r1/P2p3p/1NpPpn1Q/5b2/2P5/1P2B1P1/R6K w - - 0 1",
    "solution": [
      "a6a7",
      "b8a8",
      "b5c7",
      "d7c7",
      "h5e8",
      "c7b8",
      "a7b8q"
    ],
    "hint": "Look for a forcing sequence that mates on the fourth move.",
    "explanation": "The solution begins with a7+. The forced line is a7+ Ka8 Nc7+ Qxc7 Qe8+ Qb8 axb8=Q#, ending in checkmate.",
    "source": "lichess:00LRq"
  },
  {
    "id": "li-05FsC",
    "title": "Zwischenzug in the endgame",
    "theme": "endgame",
    "difficulty": 4,
    "rating": 2058,
    "fen": "2r1q1k1/p7/4p1p1/4Pp2/3p1P2/1Pr1P2Q/P7/4R1RK w - - 0 1",
    "solution": [
      "h3h6",
      "c8c7",
      "g1g6",
      "e8g6",
      "h6g6"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Qh6. The main line is Qh6 R8c7 Rxg6+ Qxg6 Qxg6+, which keeps a decisive advantage for White.",
    "source": "lichess:05FsC"
  },
  {
    "id": "li-04wYC",
    "title": "Zwischenzug in the endgame",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2222,
    "fen": "6k1/5pp1/R3r1qp/1p6/1B1Pr3/2P2Q1P/1n3PP1/R5K1 b - - 0 1",
    "solution": [
      "e6a6",
      "a1a6",
      "e4e1",
      "g1h2",
      "g6a6"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Rxa6. The main line is Rxa6 Rxa6 Re1+ Kh2 Qxa6, which keeps a decisive advantage for Black.",
    "source": "lichess:04wYC"
  },
  {
    "id": "li-06nUb",
    "title": "Zwischenzug and fork",
    "theme": "fork",
    "difficulty": 5,
    "rating": 2300,
    "fen": "1k1q3r/pp2b3/3p1p2/3P4/1P2PpP1/P5P1/2Q1B1P1/2R2RK1 b - - 0 1",
    "solution": [
      "d8b6",
      "f1f2",
      "f4g3",
      "c2c7",
      "b6c7",
      "c1c7",
      "g3f2",
      "g1f2",
      "b8c7"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Qb6+. The moving piece forks the pawn and king. The main line is Qb6+ Rf2 fxg3 Qc7+ Qxc7 Rxc7 gxf2+ Kxf2 Kxc7, which keeps a decisive advantage for Black.",
    "source": "lichess:06nUb"
  },
  {
    "id": "li-046Sy",
    "title": "Zwischenzug and fork",
    "theme": "fork",
    "difficulty": 4,
    "rating": 2069,
    "fen": "4r1k1/2pQ1ppq/1p2r2p/2p1N3/2P1b3/P2P4/1P3PPP/4R1K1 w - - 0 1",
    "solution": [
      "d7f7",
      "g8h8",
      "e1e4",
      "h7e4",
      "d3e4"
    ],
    "hint": "One move can attack two targets at once.",
    "explanation": "The solution begins with Qxf7+. The moving piece forks the pawn and king and rook. The main line is Qxf7+ Kh8 Rxe4 Qxe4 dxe4, which keeps a decisive advantage for White.",
    "source": "lichess:046Sy"
  },
  {
    "id": "li-000qP",
    "title": "Endgame combination",
    "theme": "endgame",
    "difficulty": 5,
    "rating": 2146,
    "fen": "8/7R/8/5p2/4bk1P/8/2r5/5KR1 b - - 0 1",
    "solution": [
      "f4f3",
      "f1e1",
      "c2c1",
      "e1d2",
      "c1g1"
    ],
    "hint": "Find the precise endgame continuation that keeps the advantage.",
    "explanation": "The solution begins with Kf3. The main line is Kf3 Ke1 Rc1+ Kd2 Rxg1, which keeps a decisive advantage for Black.",
    "source": "lichess:000qP"
  },
  {
    "id": "li-00baa",
    "title": "Skewer",
    "theme": "skewer",
    "difficulty": 4,
    "rating": 2062,
    "fen": "1r1qr1k1/p1p2ppp/1p1b1n2/3N4/3Q4/1P4P1/PBP1PPKP/R3R3 b - - 0 1",
    "solution": [
      "d6e5",
      "d5f6",
      "d8f6",
      "d4c4",
      "e5b2"
    ],
    "hint": "Check through a valuable piece so that the piece behind it is exposed.",
    "explanation": "The solution begins with Be5. The first move skewers a more valuable piece and leaves the piece behind it exposed. The main line is Be5 Nxf6+ Qxf6 Qc4 Bxb2, which keeps a decisive advantage for Black.",
    "source": "lichess:00baa"
  },
  {
    "id": "li-01A5W",
    "title": "Zwischenzug and sacrifice",
    "theme": "sacrifice",
    "difficulty": 5,
    "rating": 2300,
    "fen": "4r1k1/pp3p2/3p1Ppq/5P2/8/6RP/PP2rQ2/6RK w - - 0 1",
    "solution": [
      "g3g6",
      "f7g6",
      "f6f7",
      "g8f7",
      "f5g6",
      "f7e7",
      "f2e2"
    ],
    "hint": "Giving up material can force a winning continuation.",
    "explanation": "The solution begins with Rxg6+. The first move gives up material in order to force the continuation. The main line is Rxg6+ fxg6 f7+ Kxf7 fxg6+ Ke7 Qxe2+, which keeps a decisive advantage for White.",
    "source": "lichess:01A5W"
  }
];

export const PUZZLE_THEMES = ["mate-in-1","mate-in-2","mate-in-3","mate-in-4","fork","pin","skewer","back-rank","discovered","sacrifice","endgame","promotion","deflection","zugzwang-ish"];
