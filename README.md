# DEV-cyberjaya5g-simulation: Real-World Scaled Simulation (HTML Canvas / JS)

A to-scale (metres) simulation of the **Persiaran Ceria × Jalan Cyber Point 2 / Jln Fauna 1**
junction in Cyberjaya. It applies the prototype's anti-collision logic to **all four approaches and every lane**.

* **Left-hand traffic** (Malaysia). Persiaran Ceria has 3 lanes each way with a planted median.
  Jalan Cyber Point 2 (east) and Jln Fauna 1 (west) have 2 lanes each way.
  Zebra crossings, corner slip-lane islands and the surrounding buildings follow the satellite view.
* **30 sensors:** every inbound lane has an **Entry Sensor** (70 m before the stop line) and a
  **Stopline Sensor** (40 m before). Every lane also has an **Exit Sensor** 16 m past the far crosswalk.
* Vehicles (cars, SUVs, buses, motorcycles) follow the **Intelligent Driver Model**, a standard car-following model.
  On yellow they decide to stop or go with the dilemma-zone rule. About 15 % of drivers "roll" toward the line
  expecting the countdown timer to turn green.

## Run
No build step and no dependencies.
```bash
cd DEV-cyberjaya5g-simulation
node serve.js
```
Then open **http://localhost:5500**. You can also open `index.html` directly in Chrome or Edge.

Controls: scroll to zoom, drag to pan, double-click to fit · `Space` = pause · keys `1`–`4` start the scenarios.

## Scenarios
| | Scenario | What happens |
|---|---|---|
| 1 | **Normal Flow** | Fixed-time two-phase plan, everyone obeys. Speeds are measured in every lane, and no alerts are raised. |
| 2 | **Near-Miss** | A car doing 95 km/h on Persiaran Ceria southbound reaches its Stopline Sensor just after its light turns red. The system predicts the red-light run and **holds Jalan Cyber Point 2 / Jln Fauna 1 on red**. A cross driver rolling up on the countdown brakes, the Exit Sensor confirms the speeder has left, and cross traffic is released. **Turn the system OFF and run it again: the same cars collide.** |
| 3 | **Collision** | The cross road already has green when the speeder runs the red. The system cuts the cross green, but a car already committed to the junction is hit. The speeder never reaches its Exit Sensor, so after the timeout the system raises **CRITICAL: Suspected Collision**, locks the junction on all-red, **sounds the alarm**, opens a picture-in-picture "CAM" view and **dispatches a police car and an ambulance**, which drive to the crash site. With the system OFF, help is only called after a 25 s bystander delay. |
| 4 | **Emergency Vehicle Priority** *(extra scenario)* | An ambulance on Persiaran Ceria northbound sends a **5G V2X priority request** about 160 m out. The controller ends the conflicting green safely (yellow, then all-red), gives a **green wave** and restores the normal cycle once the ambulance's Exit Sensor fires. |

There is also a **"+ random red-light runner"** button, a density slider, and playback at ¼× to 4×.

**Sound** (Web Audio, no files): triple beep on *Speeding Detected*, a wailing alarm on a suspected collision
(🔕 *Silence alarm* stops it), and a hi-lo siren while emergency vehicles are on the move. Use 🔊 in the top bar to mute.
Browsers only play audio after your first click on the page.

**Sensor data icon:** each time a sensor detects a vehicle, a small 📶 icon in the sensor's colour rises from it,
showing the detection being transmitted to the controller.

## The maths (same as the ESP32 firmware, scaled)
| Quantity | Formula | Value here |
|---|---|---|
| Speed (time of flight) | `v = 30 m / (t_stopline − t_entry)` | |
| Spot speed | dual-loop Stopline Sensor | filters out drivers who are already braking |
| Critical speed | `v_crit = a(−t_r + √(t_r² + 2D/a))` | a = 3.4 m/s², t_r = 1 s, D = 40 m → **48 km/h** |
| Red entry predicted | RED, or YELLOW and `D / v > yellow time left` | |
| Violation | `v > v_crit` and the car can't stop and a red entry is predicted | |
| Protective delay | `max(0, t_clear + 1.5 s − t_until_cross_green)`. The hold also lasts until the Exit Sensor confirms | |
| Exit deadline | `clamp(1.6 · t_exp + 1 s, 3 s, 12 s)` | |
| Yellow time | ITE rule `t_r + v/(2a)` = 3.5 s at 60 km/h | **4 s** |

What the system does with a flagged car:
* **Above 60 km/h:** *"Speeding Detected – Delaying Cross Traffic"* alert.
* **Legal speed, but too close to stop comfortably (the dilemma zone):** the same protective hold, logged quietly.
* **Driver halts at the stop line after all:** a stop-bar presence detector cancels the watch and releases the hold.

## Files
```
js/config.js      geometry, physics, timing, vehicle classes
js/world.js       lanes, sensors, signal-head positions (left-hand traffic)
js/vehicle.js     IDM + dilemma-zone driver decisions
js/controller.js  signal state machine + anti-collision logic (events)
js/sim.js         engine: spawning, sensors (sub-step timing), crash detection
js/scenarios.js   the four scripted scenarios (timings computed from geometry)
js/renderer.js    canvas drawing, satellite-style scenery, CCTV inset
js/ui.js          panel, alerts, steps, log
js/audio.js       synthesized alarm, beeps and sirens
js/main.js        fixed-step loop (60 Hz sim time) and input
serve.js          optional zero-dependency static server
```
