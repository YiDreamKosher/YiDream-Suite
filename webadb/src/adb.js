// YiDream v1.2 — couche Web ADB (WebUSB, ya-webadb). Reprend la logique du configurateur v1.
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { PackageManager } from '@yume-chan/android-bin';
import { CONFIG, ADMIN_COMPONENT } from './config.js';

const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class YiDreamAdb {
  constructor() {
    this.adb = null;
    this.info = null;
    this.credentialStore = new AdbWebCredentialStore('YiDream Configurator');
    this.onDisconnect = () => {};
  }

  static get supported() {
    return !!AdbDaemonWebUsbDeviceManager.BROWSER;
  }

  require() {
    if (!this.adb) throw new Error('NOT_CONNECTED');
    return this.adb;
  }

  async connect(onStep = () => {}) {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new Error('UNSUPPORTED');
    onStep('searching');
    const device = await manager.requestDevice();
    if (!device) throw new Error('NO_DEVICE');
    onStep('connecting');
    let connection;
    try {
      connection = await device.connect();
    } catch (e) {
      if (e instanceof AdbDaemonWebUsbDevice.DeviceBusyError) {
        throw new Error("Appareil occupé : ferme tout autre client ADB (adb kill-server) puis réessaie.");
      }
      throw e;
    }
    onStep('authenticating');
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: this.credentialStore,
    });
    const adb = new Adb(transport);
    this.adb = adb;
    adb.disconnected.then(() => {
      if (this.adb !== adb) return;
      this.adb = null;
      this.info = null;
      this.onDisconnect();
    });
    const info = await this.readInfo();
    if (this.adb !== adb) throw new Error('NOT_CONNECTED');
    this.info = info;
    return this.info;
  }

  async disconnect() {
    const a = this.adb;
    this.adb = null;
    this.info = null;
    if (a) await a.close();
  }

  // Exécute une commande. Utilise le protocole "shell" (code de sortie) si l'appareil le supporte.
  async sh(args) {
    const sub = this.require().subprocess;
    if (sub.shellProtocol) {
      const r = await sub.shellProtocol.spawnWaitText(args);
      return { exitCode: r.exitCode, out: `${r.stdout}${r.stderr}`.trim() };
    }
    const out = await sub.noneProtocol.spawnWaitText(args);
    return { exitCode: null, out: out.trim() };
  }

  static ok(r) {
    if (r.exitCode === 0) return true;
    if (r.exitCode === null) return /Success/i.test(r.out);
    return false;
  }

  async readInfo() {
    const adb = this.require();
    const [model, manufacturer, android, sdk] = await Promise.all([
      adb.getProp('ro.product.model'),
      adb.getProp('ro.product.manufacturer'),
      adb.getProp('ro.build.version.release'),
      adb.getProp('ro.build.version.sdk'),
    ]);
    return { serial: adb.serial, model: model || '?', manufacturer: manufacturer || '', android, sdk };
  }

  async isInstalled(pkg = CONFIG.appPackage) {
    const r = await this.sh(['pm', 'list', 'packages', pkg]);
    return r.out.split('\n').some((l) => l.trim() === `package:${pkg}`);
  }

  // Installation / mise à jour (réinstaller par-dessus = update).
  async installApk(blob) {
    const pm = new PackageManager(this.require());
    await pm.installStream(blob.size, blob.stream());
  }

  async setDeviceOwner() {
    return this.sh(['dpm', 'set-device-owner', ADMIN_COMPONENT]);
  }

  // Envoie yidream_config.json : lance l'app (crée le dossier), écrit le fichier, relance l'app.
  async applyConfig(config, onStep = () => {}) {
    const adb = this.require();
    const connected = () => {
      if (this.adb !== adb) throw new Error('NOT_CONNECTED');
    };
    const launch = ['monkey', '-p', CONFIG.appPackage, '-c', 'android.intent.category.LAUNCHER', '1'];
    onStep('launching');
    await this.sh(launch);
    await sleep(2000);
    connected();
    onStep('sending');
    const sync = await adb.sync();
    try {
      const blob = new Blob([JSON.stringify(config)], { type: 'application/json' });
      await sync.write({ filename: CONFIG.configRemotePath, file: blob.stream() });
    } finally {
      await sync.dispose();
    }
    connected();
    onStep('relaunching');
    await this.sh(['am', 'force-stop', CONFIG.appPackage]);
    connected();
    await this.sh(launch);
  }

  async confirmConfiguration(serial) {
    const adb = this.require();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (this.adb !== adb || this.info?.serial !== serial) throw new Error('NOT_CONNECTED');
      const result = await this.sh(['ls', '-d', CONFIG.configRemotePath]);
      if (this.adb !== adb || this.info?.serial !== serial) throw new Error('NOT_CONNECTED');
      if (result.exitCode !== 0 && /No such file or directory/i.test(result.out)) return;
      await sleep(500);
    }
    throw new Error('CONFIGURATION_NOT_CONFIRMED');
  }

  async sendActivationCode(code, serial) {
    const adb = this.require();
    if (this.info?.serial !== serial) throw new Error('NOT_CONNECTED');
    if (!/^[0-9a-f]{32}$/i.test(code)) throw new Error('INVALID_ACCOUNT_CODE');
    let result;
    try {
      result = await this.sh([
        'am', 'start', '-W', '-n', CONFIG.appPackage + '/.UsbActivationActivity',
        '--es', 'yidream_activation_code', code
      ]);
    } catch {
      throw new Error('ACTIVATION_USB_FAILED');
    }
    if (this.adb !== adb || this.info?.serial !== serial) throw new Error('NOT_CONNECTED');
    if ((result.exitCode !== 0 && result.exitCode !== null) ||
        /(?:Error|Exception):|Status:\s*timeout/i.test(result.out) ||
        (result.exitCode === null && !/Status:\s*ok/i.test(result.out))) {
      throw new Error('ACTIVATION_USB_FAILED');
    }
  }

  removeAdmin() {
    return this.sh(['dpm', 'remove-active-admin', ADMIN_COMPONENT]);
  }

  async uninstall() {
    await this.removeAdmin();
    await sleep(1000);
    return this.sh(['pm', 'uninstall', CONFIG.appPackage]);
  }
}

export function parseExtraPackages(text) {
  const items = text.split(',').map((s) => s.trim()).filter(Boolean);
  return { valid: items.filter((p) => PKG_RE.test(p)), invalid: items.filter((p) => !PKG_RE.test(p)) };
}
