import { getPushConfig, savePushSubscription, deletePushSubscription } from '../api/notifications';

const toUint8Array = value => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64);
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
};

export const getDeviceAlertStatus = async () => {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window))
    return { supported: false, enabled: false, permission: 'unsupported' };
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return { supported: true, enabled: Boolean(subscription), permission: Notification.permission };
};

export const enablePushNotifications = async () => {
  const status = await getDeviceAlertStatus();
  if (!status.supported) throw new Error('Device alerts are not supported by this browser.');
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const config = await getPushConfig();
  if (!config.data.configured || !config.data.publicKey)
    throw new Error('Device alerts are not configured on the server yet.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: toUint8Array(config.data.publicKey),
  });
  await savePushSubscription(subscription.toJSON());
  return subscription;
};

export const disablePushNotifications = async () => {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await deletePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
};
