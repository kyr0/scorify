import assert from "node:assert/strict";

/** Runs against the served, built ESM graph in a real Chromium renderer. */
export async function checkAudio(page) {
  await page.click("#play");
  await page.waitForFunction(
    () => globalThis.scorifyPlayback?.state === "playing",
    undefined,
    { timeout: 10000 },
  );
  await page.click("#stop");
  assert.equal(await page.textContent("#audio-status"), "Stopped");
  const result = await page.evaluate(async () => {
    const { renderPerformance, createAudioPlayer } = await import(
      "/dist/audio.mjs"
    );
    const input = {
      strings: ["s"],
      durationSeconds: 0.4,
      events: [
        {
          id: "pluck",
          stringId: "s",
          frequency: 261.625565,
          onsetSeconds: 0.02,
          endSeconds: 0.3,
          excitationSeed: 923,
          velocity: 0.7,
          brightness: 0.6,
          pluckPosition: 0.22,
          decaySeconds: 2,
          muted: false,
        },
      ],
    };
    const parity = [];
    for (const sampleRate of [44100, 48000]) {
      const startFrame = 777,
        length = startFrame + Math.ceil(input.durationSeconds * sampleRate),
        context = new OfflineAudioContext(2, length, sampleRate);
      await context.audioWorklet.addModule("/dist/audio-worklet.mjs");
      const node = new AudioWorkletNode(context, "scorify-plucked-strings-v1", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(context.destination);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Offline worklet preparation timed out")),
          5000,
        );
        node.port.onmessage = ({ data }) => {
          if (data.type === "error") {
            clearTimeout(timer);
            reject(new Error(data.message));
          }
          if (data.type === "ready") {
            clearTimeout(timer);
            resolve();
          }
        };
        node.port.postMessage({ type: "load", id: 1, input, tailSeconds: 0 });
      });
      const readyToRender = new Promise((resolve, reject) => {
        node.port.onmessage = ({ data }) => {
          if (data.type === "error") reject(new Error(data.message));
        };
        // AudioWorklet messages are delivered before the first render quantum.
        node.port.postMessage({
          type: "start",
          id: 1,
          when: (startFrame - 0.01) / sampleRate,
        });
        context.startRendering().then(resolve, reject);
      });
      const rendered = await readyToRender,
        expected = renderPerformance(input, { sampleRate, tailSeconds: 0 });
      let maxError = 0,
        peak = 0;
      for (let c = 0; c < 2; c++) {
        const actual = rendered.getChannelData(c);
        for (let i = 0; i < length; i++) {
          const target =
            i < startFrame ? 0 : expected.channels[c][i - startFrame];
          maxError = Math.max(maxError, Math.abs(actual[i] - target));
          peak = Math.max(peak, Math.abs(actual[i]));
        }
      }
      node.port.close();
      node.disconnect();
      parity.push({ sampleRate, maxError, peak, startFrame });
    }
    const context = new AudioContext(),
      analyser = context.createAnalyser();
    analyser.connect(context.destination);
    const player = await createAudioPlayer(context, { destination: analyser }),
      plan = globalThis.scorifyPerformance.performance;
    const handle = await player.play(plan);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const peak = Math.max(...samples.map(Math.abs));
    handle.stop();
    const stopped = await handle.finished;
    const earlier = player.play(plan).then(
        () => "unexpected",
        (error) => error.name,
      ),
      later = player.play(plan);
    const replaced = await earlier,
      latest = await later;
    player.dispose();
    const disposed = await latest.finished;
    await context.close();
    return {
      parity,
      realtimePeak: peak,
      stopReason: stopped.reason,
      replaced,
      disposeReason: disposed.reason,
    };
  });
  for (const item of result.parity) {
    assert.ok(item.maxError < 1e-7, JSON.stringify(item));
    assert.ok(item.peak > 0.005);
  }
  assert.ok(result.realtimePeak > 0.001, JSON.stringify(result));
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.replaced, "AbortError");
  assert.equal(result.disposeReason, "disposed");
  return result;
}

/** The pitch-detector AudioWorklet in a real renderer: sawtooth tones through createPitchInput on an offline context. */
export async function checkPitch(page) {
  const result = await page.evaluate(async () => {
    const { createPitchInput, tuningTargets, nearestTarget, classicalGuitar } = {
      ...(await import("/dist/tuner.mjs")),
      ...(await import("/dist/index.mjs")),
    };
    const targets = tuningTargets(classicalGuitar());
    const heard = [];
    for (const frequency of [82.4069, 110 * 2 ** (30 / 1200), 196 * 2 ** (-12 / 1200), 329.6276]) {
      const context = new OfflineAudioContext(1, 48000, 48000),
        source = new OscillatorNode(context, { type: "sawtooth", frequency }),
        readings = [];
      const gain = new GainNode(context, { gain: 0.3 });
      source.connect(gain);
      const input = await createPitchInput(context, { source: gain, minFrequency: 70, onPitch: (r) => readings.push(r) });
      source.start();
      await context.startRendering();
      await new Promise((resolve) => setTimeout(resolve, 100));
      input.stop();
      const last = readings.filter((r) => r.frequency).at(-1);
      const reading = nearestTarget(last.frequency, targets);
      heard.push({ frequency, readings: readings.length, detected: last.frequency, string: reading.target.pitch, cents: reading.cents, contextTime: last.contextTime });
    }
    return heard;
  });
  const expected = [["E2", 0], ["A2", 30], ["G3", -12], ["E4", 0]];
  result.forEach((r, i) => {
    assert.ok(r.readings >= 20, `pitch readings arrive per hop (${r.readings})`);
    assert.equal(r.string, expected[i][0]);
    assert.ok(Math.abs(r.cents - expected[i][1]) < 1, `${r.string}: ${r.cents} cents, expected ${expected[i][1]}`);
    assert.ok(r.contextTime > 0.5 && r.contextTime <= 1, `context time ${r.contextTime}`);
  });
  return result.map(({ string, cents, readings }) => ({ string, cents: Math.round(cents * 10) / 10, readings }));
}
