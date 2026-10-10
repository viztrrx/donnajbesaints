// Chromebox Micro starting preset for the verified EaglercraftX 1.8 u35 build.
// Its "g" settings record is base64-encoded gzip text, one key:value per line.
(function () {
  'use strict';
  var preset = {
    // u35 stores FOV normalized: degrees = value * 40 + 70. 1 = Quake Pro (110°).
    fov: '1.0',
    renderDistance: '2', maxFps: '60', fancyGraphics: 'false', ao: '0',
    renderClouds: 'false', particles: '2', mipmapLevels: '0',
    enableVsyncEag: 'false', fxaa: '2', shaders: 'false',
    enableDynamicLights: 'false', entityShadows: 'false', anaglyph3d: 'false'
  };
  window.eaglerApplyPerformancePreset = async function (namespace) {
    var key = namespace + '.g';
    var original = localStorage.getItem(key);
    var active = true;
    var timer;
    var work = async function () {
      var text = '';
      if (original !== null) {
        if (original.length > 1048576) throw new Error('Settings record too large');
        var binary = atob(original);
        var bytes = Uint8Array.from(binary, function (c) { return c.charCodeAt(0); });
        text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        if (text.length > 1048576 || !text.includes(':')) throw new Error('Unrecognized settings record');
      }
      // Preserve every unrecognized field, including controls, selected packs,
      // language and audio. Remove duplicate preset keys before appending them.
      var lines = text.split(/\r\n|\n|\r/).filter(function (line) {
        return line && !Object.prototype.hasOwnProperty.call(preset, line.split(':', 1)[0]);
      });
      Object.keys(preset).forEach(function (name) { lines.push(name + ':' + preset[name]); });
      var compressed = new Uint8Array(await new Response(
        new Blob([lines.join('\n') + '\n']).stream().pipeThrough(new CompressionStream('gzip'))
      ).arrayBuffer());
      var output = '';
      compressed.forEach(function (b) { output += String.fromCharCode(b); });
      if (!active) return;
      // Do not overwrite a settings save from another open game during await.
      if (localStorage.getItem(key) !== original) throw new Error('Settings changed in another game window');
      var backupKey = namespace + '.agent-console.performance-original';
      if (original !== null && localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, original);
      localStorage.setItem(key, btoa(output));
      return 'applied';
    };
    try {
      return await Promise.race([work(), new Promise(function (_, reject) {
        timer = setTimeout(function () { active = false; reject(new Error('Performance settings timed out')); }, 5000);
      })]);
    } finally { active = false; clearTimeout(timer); }
  };
})();
