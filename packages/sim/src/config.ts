/** Tunable gameplay parameters. Units: world units, seconds. See specification.md §3.2. */
export interface SimConfig {
  /** Downward acceleration (u/s²), multiplied by the level's gravityScale. */
  gravity: number;
  /** Main (upward) thruster acceleration (u/s²). */
  thrustUp: number;
  /** Left/right thruster acceleration (u/s²). */
  thrustSide: number;
  /** Downward thruster acceleration (u/s²). */
  thrustDown: number;
  /** Linear drag (1/s) with the gear retracted. */
  dragGearUp: number;
  /** Linear drag (1/s) with the gear deployed. */
  dragGearDown: number;
  /** Speed clamp (u/s). */
  maxSpeed: number;

  /** Max downward speed for a safe touchdown (u/s). */
  landMaxVy: number;
  /** Max horizontal speed for a safe touchdown (u/s). */
  landMaxVx: number;
  /**
   * "Glide" landings: touching down while moving sideways at least landGlideVx (u/s) allows
   * landGlideBonusVy more downward speed, like an airplane landing with forward speed.
   */
  landGlideVx: number;
  landGlideBonusVy: number;
  /** Touchdowns faster than this sideways rate "rough" (costs tip) even if the drop was soft. */
  landRoughVx: number;
  /** Touchdown at or below this vertical speed rates "smooth". */
  landSmoothVy: number;
  /** Touchdown at or below this vertical speed rates "ok"; above (but safe) is "rough". */
  landOkVy: number;

  /** Fraction of the skid width that must rest on solid ground to land (0–1). */
  landMinSupport: number;

  /** Seconds to fully raise or lower the landing gear. */
  gearTime: number;

  fuelMax: number;
  /** Fuel burned per second by each thruster. */
  burnUp: number;
  burnSide: number;
  burnDown: number;
  /** Gas is bought at stores by the gallon (no automatic refueling): fuel units per gallon,
   * and the price of one gallon. */
  fuelPerGallon: number;
  gallonPrice: number;

  startMoney: number;

  /**
   * Passengers in play at once (waiting, walking or riding) =
   * passengersPerTaxi × number of taxis + extraPassengers. Both 0 disables spawning.
   */
  passengersPerTaxi: number;
  extraPassengers: number;
  /** Seconds into a level before the first rival arrives; each further rival arrives
   * npcArrivalInterval (+ up to npcArrivalJitter) seconds after the previous one. */
  npcArrivalDelay: number;
  npcArrivalInterval: number;
  npcArrivalJitter: number;

  /**
   * Rival population (world coordinator). Living rivals: at most rivalsMaxWorld in the world
   * and rivalsMaxPerLocale in one locale (the player not counted). A locale is short of taxis
   * when at least demandShortage unclaimed passengers have each waited demandWaitSeconds;
   * that's checked every demandCheckSeconds. A response (redirecting a rival, or a new one) is
   * reserved for dispatchTimeoutSeconds before the shortage can trigger another, and new
   * rivals appear at most once every rivalSpawnCooldownSeconds.
   */
  rivalsMaxWorld: number;
  rivalsMaxPerLocale: number;
  demandShortage: number;
  demandWaitSeconds: number;
  demandCheckSeconds: number;
  dispatchTimeoutSeconds: number;
  rivalSpawnCooldownSeconds: number;
  /** Seconds before the first passenger appears. */
  firstPassengerDelay: number;
  /** Seconds between a passenger leaving play and the next one appearing. */
  passengerSpawnDelay: number;
  /** Passenger walking speed (u/s). */
  walkSpeed: number;
  /** Fare = baseFare + farePerDistance × straight-line distance between pads. */
  baseFare: number;
  farePerDistance: number;
  /**
   * Tips are a percentage of the fare (so the locale multiplier applies): tipPercent for good,
   * on-time service, less the service cuts below (percentage points), never below 0. Arriving
   * early adds a bonus, up to tipPercentMax in all.
   */
  tipPercent: number;
  tipPercentMax: number;
  /** A ride is on time within tripAllowance s + straight-line distance ÷ tripPace (u/s). */
  tripAllowance: number;
  tripPace: number;
  /** Points lost per second late, and gained per second early (paid at drop-off). */
  tipLatePerSecond: number;
  tipEarlyPerSecond: number;
  /** Points lost per "ok" / "rough" landing; a hard landing (hull damage) costs the extra on top of rough. */
  tipCutOk: number;
  tipCutRough: number;
  tipCutHardLanding: number;
  /** Points lost per skid bump or taxi bump, and per other hull damage (a missile hit, a wall). */
  tipCutBump: number;
  tipCutDamage: number;
  /** Points lost at boarding for each time the taxi took off while they walked to it. */
  tipCutAnnoyed: number;
  /** Money lost for hitting a passenger with the taxi. */
  hitPenalty: number;


  /** Hull points; at zero the taxi is destroyed (permanently). */
  taxiMaxHp: number;
  /** Hull points lost per missile hit and per collision (wall, ceiling, hard/bad landing, other taxi). */
  missileDamage: number;
  collisionDamage: number;
  /** Impacts slower than this (u/s) are harmless scrapes. */
  collisionMinSpeed: number;
  /** Seconds after a damaging collision during which further collisions do no damage. */
  collisionGrace: number;
  /** Fraction of impact speed kept (reversed) when bouncing off something. */
  collisionBounce: number;
  /** Velocity (u/s) a non-lethal missile hit knocks a flying taxi along the missile's path. */
  missileKnockback: number;

  /** Never run out of missiles (only the cooldown limits firing). Off by default. */
  missilesUnlimited: boolean;
  /** Missiles each taxi starts with, the most it can carry, and seconds between shots. */
  startMissiles: number;
  missileMax: number;
  missileCooldown: number;
  /** Seconds to regenerate one missile for free (0 = never; buy them at stores). */
  missileReload: number;

  /** Countermeasure flares: starting count, most carried, seconds between bursts. */
  startFlares: number;
  flareMax: number;
  flareCooldown: number;
  /** A burst affects missiles chasing you within this range (u); each is decoyed with this chance. */
  flareRange: number;
  /** Seconds a flare burns (a fooled missile chases it until it hits it or it burns out). */
  flareBurnTime: number;
  flareSuccess: number;
  /** The co-pilot notices missiles closing in within this range (capped at flareRange). */
  copilotThreatRange: number;

  /** Convenience-store prices (fuel pads also sell these). */
  missilePrice: number;
  flarePrice: number;
  /** Price per hull point repaired at a store. */
  repairPrice: number;
  /** Price multiplier charged by the flying convenience service (e.g. 2 = 2× store prices). */
  servicePriceMultiplier: number;
  /** Launch speed (u/s), top speed (u/s), acceleration (u/s²), turn rate (rad/s), lifetime (s). */
  missileLaunchSpeed: number;
  missileSpeed: number;
  missileAccel: number;
  missileTurnRate: number;
  missileLife: number;
}

export const DEFAULT_CONFIG: Readonly<SimConfig> = Object.freeze({
  gravity: 220,
  thrustUp: 420,
  thrustSide: 260,
  thrustDown: 150,
  dragGearUp: 0.3,
  dragGearDown: 0.4,
  maxSpeed: 450,

  landMaxVy: 130,
  // Raised from 60 so moderate sideways speed at touchdown is survivable (2026-11-24).
  landMaxVx: 120,
  landGlideVx: 40,
  landGlideBonusVy: 40,
  landRoughVx: 60,
  landSmoothVy: 45,
  landOkVy: 85,
  landMinSupport: 0.5,

  gearTime: 0.4,

  fuelMax: 100,
  // Halved from 6 / 3 / 2 after playtesting (2× fuel efficiency).
  burnUp: 2.5, // 20% more efficient than 3 / 1.5 / 1 (2026-11-25): burn ÷ 1.2
  burnSide: 1.25,
  burnDown: 0.8333,
  fuelPerGallon: 10, // a full tank (100) is 10 gallons
  gallonPrice: 2, // a full tank is $20: a typical fare (~$10-15 + tip) pays for the gas it burns

  startMoney: 100,

  passengersPerTaxi: 1,
  extraPassengers: 1,
  npcArrivalDelay: 5,
  npcArrivalInterval: 10,
  npcArrivalJitter: 4,
  rivalsMaxWorld: 36,
  rivalsMaxPerLocale: 6,
  demandShortage: 2,
  demandWaitSeconds: 15,
  demandCheckSeconds: 5,
  dispatchTimeoutSeconds: 60,
  rivalSpawnCooldownSeconds: 15,
  firstPassengerDelay: 1,
  passengerSpawnDelay: 2,
  walkSpeed: 70,
  // Raised 20% (was $5 + $0.010/u), 2026-11-24.
  baseFare: 6,
  farePerDistance: 0.012,
  // Tips as a percentage of the fare (2026-11-25; was a $10 tip draining $0.40/s). The on-time
  // allowance is set so careful rivals earn a median of ~17% (19 / 18 / 14% in First Shift /
  // Midtown / Skyline, measured over ~780 rides); quick, clean flying earns 20-25%.
  tipPercent: 20,
  tipPercentMax: 25,
  tripAllowance: 6,
  tripPace: 100,
  tipLatePerSecond: 0.5,
  tipEarlyPerSecond: 0.5,
  tipCutOk: 2,
  tipCutRough: 5,
  tipCutHardLanding: 3, // rough + this = 8
  tipCutBump: 3,
  tipCutDamage: 5,
  tipCutAnnoyed: 3,
  hitPenalty: 20,

  // 6 collisions or 3 missile hits destroy a healthy taxi.
  taxiMaxHp: 6,
  missileDamage: 2,
  collisionDamage: 1,
  collisionMinSpeed: 30,
  collisionGrace: 0.5,
  collisionBounce: 0.35,
  missileKnockback: 140,

  missilesUnlimited: false,
  startMissiles: 3,
  missileMax: 9,
  missileCooldown: 0.6,
  missileReload: 0,

  startFlares: 3,
  flareMax: 9,
  flareCooldown: 0.5,
  flareRange: 320,
  copilotThreatRange: 300,
  flareBurnTime: 2.2,
  flareSuccess: 0.95, // per missile, for manual and automatic bursts alike

  missilePrice: 12,
  flarePrice: 6,
  repairPrice: 20,
  servicePriceMultiplier: 2,
  missileLaunchSpeed: 160,
  missileSpeed: 380,
  missileAccel: 520,
  missileTurnRate: 3.2,
  missileLife: 3.5, // motor burn (s): ~1,100 u of powered flight, then it falls
});
