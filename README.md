# Hogs of War 3: Modern Warfare

A fan-made 3D turn-based tactical pig-warfare game. Drones, stealth bombers, HIMARS, modern armour and carrier groups — up to six squads, all on one machine.

**▶ [Play it here](https://zo0pz.github.io/hogs-of-war-3/)**

Nothing to install. It runs in any modern browser and works with keyboard & mouse, a gamepad, or touch.

---

## Playing online

One player picks **Play Online — Host** and reads out the five-character room code. Everybody else picks **Play Online — Join** and types it in. Up to six squads, each on their own machine, anywhere. Any seat nobody takes is played by the computer.

Your browsers talk **directly to each other** — there is no server in the middle.

If somebody drops out the game **pauses and waits** for them, so nobody loses a turn to broken wifi. The host can also hand that squad to the computer and carry on; the missing player can rejoin with the same code at any point and **take their squad straight back off the CPU**, caught up on everything they missed.

## Playing round one screen

On the **Enlist Your Nation** screen, choose how many squads take the field — **2 to 6** — and set each one to **Human** or **CPU**. Everyone plays on the same machine, taking it in turn.

When control passes from one person to another, a **Pass the Controls** card names whose go it is and holds the clock until they're ready, so nobody watches the previous player line up their shot.

Last squad standing wins.

## Controls

**Keyboard & mouse**

| | |
|---|---|
| `WASD` | move (and drive whatever you're crewing) |
| `Q` | hop |
| drag mouse | orbit the camera |
| `↑` `↓` | launch angle |
| hold `SPACE` | charge, release to fire |
| `1`–`0`, `-`, `=` | select weapon |
| hold left mouse | sight up — rifle, DMR, LMG and thermobaric drop into first person |
| `E` | get in / out of a vehicle or gun position |
| `H` | field manual (also rebinds every key and replays the tutorial) |

**Gamepad** — left stick moves and drives · right stick looks · RT charges and fires · LB/RB cycle weapons · A hops · **B gets in and out of vehicles**.

**Touch** — on-screen controls appear automatically on phones and tablets.

## What's in it

- **25 operations** across six theatres, with a squad that gains ranks, health and upgrades as you go
- **20 weapons** including a stealth bomber with a top-down bombsight, HIMARS, Javelin, thermobaric rounds and claymores
- **Modern armour, RHIBs and a carrier group** you sail out to and take command of
- **Destructible everything** — buildings come apart block by block and the ground craters
- **Rising water** after round 12, which floods the low ground and breaks the map into islands
- **A battle report** after every fight: shots, accuracy, kills, K/D, damage, longest kill and more, plus a cumulative service record across a campaign

## Building from source

The playable file is a single self-contained HTML page. To rebuild it:

```bash
cd source
npm install three@0.170.0 esbuild
node build.mjs
```

That bundles `main.js` with Three.js and inlines the result into `template.html`.

---

Made for fun as a tribute to Infogrames' *Hogs of War* (1999). Not affiliated with or endorsed by the rights holders.
