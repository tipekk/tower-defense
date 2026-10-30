// Economy.js - gold tracking for Bastion Grid.

export const STARTING_GOLD = 150;

export class Economy {
  constructor(startingGold = STARTING_GOLD) {
    this.gold = startingGold;
  }

  canAfford(amount) {
    return this.gold >= amount;
  }

  /** Spend gold on a build/upgrade. Returns false (no-op) if insufficient funds. */
  spend(amount) {
    if (!this.canAfford(amount)) return false;
    this.gold -= amount;
    return true;
  }

  /** Reward for a kill. */
  addBounty(amount) {
    this.gold += amount;
  }

  /** Refund from selling a tower (caller computes the 70% via Tower.sell()). */
  refund(amount) {
    this.gold += amount;
  }
}
