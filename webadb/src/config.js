// YiDream v1.2 — configuration du configurateur Web.
export const CONFIG = {
  // App Android (dossier app/ du dépôt)
  appPackage: 'com.yidream.mdm',
  adminReceiver: '.MyDeviceAdminReceiver',
  // Fichier lu par l'app au démarrage (voir MainActivity.kt)
  configRemotePath: '/sdcard/Android/data/com.yidream.mdm/files/yidream_config.json',
  // Doit rester identique à UnlockManager.kt côté Android
  unlockSalt: 'yidream-unlock-v1',

  // ⚠️ Simple verrou d'interface : ce hash est lisible par n'importe qui dans le code du site.
  // Ce n'est PAS une protection forte. Mot de passe par défaut : "changeme123" → CHANGE-LE.

  // Le site refuse de fonctionner ailleurs que sur ces adresses.
  allowedSites: [
    { origin: 'https://yidreamkosher.github.io', paths: ['/YiDream/', '/YiDream-Suite/'] },
  ],
};

export const ADMIN_COMPONENT = `${CONFIG.appPackage}/${CONFIG.adminReceiver}`;
