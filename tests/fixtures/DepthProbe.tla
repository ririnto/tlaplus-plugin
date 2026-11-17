----------------------------- MODULE DepthProbe -----------------------------
EXTENDS Naturals, Sequences, TLC
VARIABLE x
Init == x = 0
Next == /\ x' = x + 1
        /\ PrintT("TLAPLUS_DEPTH=" \o ToString(x'))
TypeOK == x \in Nat
=============================================================================
