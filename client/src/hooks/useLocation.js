import { useState, useEffect, useRef } from 'react';
import { updateLiveLocation } from '../api/dtr';

const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Kalman filter for smoothing GPS coordinates
class KalmanFilter {
  constructor() {
    this.variance = -1;
    this.minAccuracy = 1;
  }

  process(lat, lng, accuracy, timestampMs) {
    if (accuracy < this.minAccuracy) accuracy = this.minAccuracy;

    if (this.variance < 0) {
      this.timestampMs = timestampMs;
      this.lat = lat;
      this.lng = lng;
      this.variance = accuracy * accuracy;
    } else {
      const timeInc = timestampMs - this.timestampMs;
      if (timeInc > 0) {
        this.variance += (timeInc * 3 * 3) / 1000;
        this.timestampMs = timestampMs;
      }

      const k = this.variance / (this.variance + accuracy * accuracy);
      this.lat += k * (lat - this.lat);
      this.lng += k * (lng - this.lng);
      this.variance = (1 - k) * this.variance;
    }

    return { lat: this.lat, lng: this.lng };
  }
}

const useLocation = (officeLat, officeLng, radiusMeters, onExitPerimeter, isClockedIn, approvedLocations = []) => {
  const [coords, setCoords] = useState(null);
  const [distance, setDistance] = useState(null);
  const [isInside, setIsInside] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState(null);
  const [matchedLocation, setMatchedLocation] = useState(null);
  const watchRef = useRef(null);
  const wasInsideRef = useRef(null);
  const lastUploadRef = useRef(0);
  const kalmanRef = useRef(new KalmanFilter());
  const positionsRef = useRef([]);
  const stablePositionRef = useRef(null);
  const onExitRef = useRef(onExitPerimeter);

  useEffect(() => {
    onExitRef.current = onExitPerimeter;
  }, [onExitPerimeter]);

  useEffect(() => {
    if (!isClockedIn) return undefined;
    const stable = stablePositionRef.current;
    if (!stable) return undefined;
    lastUploadRef.current = Date.now();
    updateLiveLocation({
      latitude: stable.latitude,
      longitude: stable.longitude,
      accuracy: stable.accuracy,
    }).catch(() => setError('Live location could not be synced. Retrying automatically.'));
    return undefined;
  }, [isClockedIn]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported.');
      return;
    }

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const rawLat = pos.coords.latitude;
        const rawLng = pos.coords.longitude;
        const rawAcc = pos.coords.accuracy;
        const timestamp = pos.timestamp;

        // Skip if accuracy is very poor (> 200m)
        if (rawAcc > 200) return;

        // Apply Kalman filter for smoother coordinates
        const filtered = kalmanRef.current.process(rawLat, rawLng, rawAcc, timestamp);

        // Keep rolling average of last 3 positions for extra smoothing
        positionsRef.current.push({ lat: filtered.lat, lng: filtered.lng });
        if (positionsRef.current.length > 3) positionsRef.current.shift();

        const avgLat = positionsRef.current.reduce((s, p) => s + p.lat, 0) / positionsRef.current.length;
        const avgLng = positionsRef.current.reduce((s, p) => s + p.lng, 0) / positionsRef.current.length;

        // Hold small changes that fit inside the receiver's own error radius. This
        // removes the common "walking marker" effect without hiding real movement.
        const previous = stablePositionRef.current;
        const movement = previous
          ? getDistance(previous.latitude, previous.longitude, avgLat, avgLng)
          : Infinity;
        const jitterThreshold = Math.max(2, Math.min(12, rawAcc * 0.25));
        const substantiallyBetter = previous && rawAcc < previous.accuracy * 0.7;
        if (!previous || movement >= jitterThreshold || substantiallyBetter) {
          stablePositionRef.current = { latitude: avgLat, longitude: avgLng, accuracy: rawAcc };
        }
        const stable = stablePositionRef.current;

        setCoords({ latitude: stable.latitude, longitude: stable.longitude, accuracy: rawAcc });
        setAccuracy(Math.round(rawAcc));
        setError(null);

        const locations = approvedLocations.length ? approvedLocations : [{
          name: 'Primary worksite', latitude: officeLat, longitude: officeLng,
          geoRadiusMeters: radiusMeters, attendanceMode: 'fixed',
        }];
        const candidates = locations.filter(location => Number.isFinite(Number(location.latitude))
          && Number.isFinite(Number(location.longitude))).map(location => ({
            ...location,
            distance: getDistance(stable.latitude, stable.longitude, Number(location.latitude), Number(location.longitude)),
          })).sort((a, b) => a.distance - b.distance);
        const nearest = candidates[0];
        if (nearest) {
          const accepted = candidates.find(location => {
            if (location.attendanceMode !== 'fixed') return true;
            const radius = Number(location.geoRadiusMeters || 50);
            return location.distance + rawAcc <= radius;
          });
          const definitelyOutside = candidates.every(location => location.attendanceMode === 'fixed'
            && location.distance - rawAcc > Number(location.geoRadiusMeters || 50));
          // In the uncertain band, keep the previous state instead of flickering or
          // raising a false perimeter-exit warning.
          const inside = accepted ? true : definitelyOutside ? false
            : (wasInsideRef.current ?? nearest.distance <= Number(nearest.geoRadiusMeters || 50));
          const dist = accepted?.distance ?? nearest.distance;
          setMatchedLocation(accepted || nearest);
          setDistance(Math.round(dist));
          setIsInside(inside);

          // Detect exit
          if (wasInsideRef.current === true && !inside) {
            onExitRef.current?.({
              distance: Math.round(dist),
              latitude: stable.latitude,
              longitude: stable.longitude,
              accuracy: rawAcc,
            });
          }
          wasInsideRef.current = inside;
        }

        // Share live location only during an active shift.
        const now = Date.now();
        if (isClockedIn && now - lastUploadRef.current > 15000) {
          lastUploadRef.current = now;
          updateLiveLocation({
            latitude: stable.latitude,
            longitude: stable.longitude,
            accuracy: rawAcc,
          }).catch(() => setError('Live location could not be synced. Retrying automatically.'));
        }
      },
      (err) => {
        if (err.code === 1) setError('GPS access denied. Please allow location.');
        else if (err.code === 2) setError('GPS position unavailable. Please try again.');
        else setError('GPS timeout. Please check your settings.');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,         // Always get fresh position
        timeout: 10000,
      }
    );

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
    };
  }, [officeLat, officeLng, radiusMeters, isClockedIn, approvedLocations]);

  return { coords, distance, isInside, accuracy, error, matchedLocation };
};

export default useLocation;
