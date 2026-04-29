import Client from './client';
import Patcher, { ogPlayerAPI } from './utils/patcher';
import SettingsManager from './utils/settings';
import UI from './ui/ui';
import pJson from '../package.json';
import './utils/spotifyUtils';
import {
  forcePlayTrack,
  getCurrentTrackUri,
  getTrackData,
  getTrackType,
  isListenableTrackType,
  isTrackPaused,
  pauseTrack,
  resumeTrack,
  SpotifyUtils,
  TrackType,
} from './utils/spotifyUtils';
import { buildApiUrl } from './utils/sessionUrl';

const AD_CHECK_INTERVAL = 2000;
const SYNC_INTERVAL = 1000;
const UPDATE_CHECK_INTERVAL = 5 * 60_000;
const UPDATE_REMIND_LATER_MS = 6 * 60 * 60_000;
export default class LTPlayer {
  client = new Client(this);
  patcher = new Patcher(this);
  spotifyUtils = new SpotifyUtils(this);
  settingsManager = new SettingsManager(Spicetify.LocalStorage);
  ui = new UI(this);
  isHost = false;
  isPlaybackLeader = false;
  version = pJson.version;
  watchingAd = false;
  trackLoaded = true;
  currentLoadingTrack = '';
  updateCheckInterval: NodeJS.Timer | null = null;
  notifiedUpdateVersion = '';

  volumeChangeEnabled = false;
  canChangeVolume = true;
  lastVolume: number | null = null;

  constructor() {}

  startUpdateChecker() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    this.checkForUpdates();
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, UPDATE_CHECK_INTERVAL);
  }

  remindUpdateLater(version: string) {
    this.notifiedUpdateVersion = version;
    this.settingsManager.settings.updateRemindUntil =
      Date.now() + UPDATE_REMIND_LATER_MS;
    this.settingsManager.saveSettings();
  }

  async checkForUpdates(forceNotify = false) {
    const settings = this.settingsManager.settings;

    if (!settings.updateNotifications && !forceNotify) {
      return;
    }

    if (!settings.server) {
      if (forceNotify) {
        this.ui.bottomMessage('Set a Listen Together server before checking for updates.');
      }
      return;
    }

    try {
      const response = await fetch(buildApiUrl(settings.server, '/api/version'));
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const nextVersion =
        data.pluginVersion ||
        data.clientRecommendedVersion ||
        data.version ||
        '';
      const updateUrl =
        data.updateUrl ||
        'https://github.com/NekoSuneProjects/spotify-listen-together/releases/latest';

      if (!nextVersion || compareVersions(nextVersion, this.version) <= 0) {
        if (forceNotify) {
          this.ui.bottomMessage('Listen Together is up to date.');
        }
        return;
      }

      if (
        !forceNotify &&
        Date.now() < settings.updateRemindUntil &&
        this.notifiedUpdateVersion === nextVersion
      ) {
        return;
      }

      this.notifiedUpdateVersion = nextVersion;
      if (settings.autoOpenUpdatePage) {
        window.location.href = updateUrl;
      } else {
        this.ui.updateAvailablePopup(nextVersion, updateUrl);
      }
    } catch (error) {
      if (forceNotify) {
        this.ui.bottomMessage('Could not check Listen Together updates.');
      }
    }
  }

  init() {
    this.patcher.patchAll();
    this.patcher.trackChanged.on((trackUri) => {
      this.onSongChanged(trackUri!);
    });

    setInterval(() => {
      this.resumeTrackIfAdPlaying();
    }, AD_CHECK_INTERVAL);

    setInterval(() => {
      this.syncPlaybackHeartbeat();
    }, SYNC_INTERVAL);

    // this.volumeChangeEnabled = !!ogPlayerAPI.setVolume;

    // For testing
    (<any>Spicetify).OGFunctions = ogPlayerAPI;
  }

  unload() {
    this.patcher.unpatchAll();
  }

  private resumeTrackIfAdPlaying() {
    if (this.client.connected && getTrackType() === TrackType.Ad) {
      resumeTrack();
    }
  }

  requestChangeSong(trackUri: string) {
    this.client.socket?.emit('requestChangeSong', trackUri);
  }

  canControlPlayback() {
    return this.isHost || this.isPlaybackLeader;
  }

  private syncPlaybackHeartbeat() {
    if (!this.client.connected || !this.canControlPlayback() || !this.trackLoaded) {
      return;
    }

    if (!isListenableTrackType(getTrackType())) {
      return;
    }

    this.client.socket?.emit(
      'requestUpdateSong',
      isTrackPaused(),
      Spicetify.Player.getProgress(),
    );
  }

  requestUpdateSong(paused: boolean, milliseconds: number) {
    let trackType = getTrackType();

    if (isListenableTrackType(trackType))
      this.client.socket?.emit('requestUpdateSong', paused, milliseconds);
    else
      this.onUpdateSong(
        paused,
        trackType === TrackType.Ad ? undefined : milliseconds,
      );
  }

  async requestSong(trackUri: string) {
    let data = await getTrackData(trackUri);
    if (data && data.error === undefined) {
      this.client.socket?.emit(
        'requestSong',
        trackUri,
        data.name || 'UNKNOWN NAME',
        {
          artist_name: Array.isArray(data.artists)
            ? data.artists.map((artist: any) => artist.name).filter(Boolean).join(', ')
            : '',
          album_title: data.album?.name || '',
          image_url: data.album?.images?.[0]?.url || '',
        },
      );
    } else {
      console.error('Failed to request song:', data?.error);
    }
  }

  addToQueue(items: Spicetify.ContextTrack[]) {
    this.client.socket?.emit('addToQueue', items);
  }

  removeFromQueue(items: Spicetify.ContextTrack[]) {
    this.client.socket?.emit('removeFromQueue', items);
  }

  clearQueue() {
    this.client.socket?.emit('clearQueue');
  }

  skipToNextTrack() {
    ogPlayerAPI.skipToNext();
  }

  // Server emitted events
  onQueueUpdate(queue: Spicetify.ContextTrack[]) {
    ogPlayerAPI.clearQueue();
    ogPlayerAPI.addToQueue(queue);
  }

  onAddToQueue(items: Spicetify.ContextTrack[]) {
    ogPlayerAPI.addToQueue(items);
  }

  onRemoveFromQueue(items: Spicetify.ContextTrack[]) {
    ogPlayerAPI.removeFromQueue(items);
  }

  onClearQueue() {
    ogPlayerAPI.clearQueue();
  }

  private async buildSongInfo(trackUri: string) {
    const currentItem = Spicetify.Platform.PlayerAPI._state?.item;
    const fallbackImage = currentItem?.images?.[0]?.['url'] || '';
    const fallbackArtists =
      currentItem?.artists?.map((artist: any) => artist.name) || [];
    const fallbackArtistName = fallbackArtists.join(', ');
    const fallbackAlbumName = currentItem?.album?.name || '';
    const fallbackDurationMs =
      currentItem?.duration?.milliseconds ||
      currentItem?.duration?.totalMilliseconds ||
      Spicetify.Player.getDuration() ||
      0;

    try {
      const data = await getTrackData(trackUri);
      if (data && data.error === undefined) {
        const artists = Array.isArray(data.artists)
          ? data.artists.map((artist: any) => artist.name).filter(Boolean)
          : fallbackArtists;

        return {
          name: data.name || currentItem?.name || '',
          image: data.album?.images?.[0]?.url || fallbackImage,
          artistName: artists.join(', '),
          artists,
          albumName: data.album?.name || fallbackAlbumName,
          durationMs: data.duration_ms || fallbackDurationMs,
          trackUri,
          paused: isTrackPaused(),
        };
      }
    } catch (error) {
      console.error('Failed to enrich current song info:', error);
    }

    return {
      name: currentItem?.name || '',
      image: fallbackImage,
      artistName: fallbackArtistName,
      artists: fallbackArtists,
      albumName: fallbackAlbumName,
      durationMs: fallbackDurationMs,
      trackUri,
      paused: isTrackPaused(),
    };
  }

  private async emitCurrentSongInfo(trackUri: string) {
    const songInfo = await this.buildSongInfo(trackUri);
    this.client.socket?.emit('changedSong', trackUri, songInfo);
  }

  onChangeSong(trackUri: string) {
    if (this.currentLoadingTrack === trackUri) {
      if (this.trackLoaded) {
        this.emitCurrentSongInfo(this.currentLoadingTrack);
      }
    } else {
      forcePlayTrack(trackUri);
    }
  }

  onUpdateSong(pause: boolean, milliseconds?: number) {
    if (milliseconds != undefined) ogPlayerAPI.seekTo(milliseconds);

    if (pause) {
      pauseTrack();
    } else {
      resumeTrack();
    }
  }

  // Events
  onSongChanged(trackUri?: string) {
    if (trackUri === undefined) trackUri = getCurrentTrackUri();

    console.log(`Changed track to ${trackUri}`);
    this.currentLoadingTrack = trackUri;

    if (this.client.connected) {
      if (isListenableTrackType(getTrackType(trackUri))) {
        this.trackLoaded = false;
        this.client.socket?.emit('loadingSong', trackUri);

        this.spotifyUtils.onTrackLoaded(trackUri!, () => {
          this.trackLoaded = true;
          if (!this.canControlPlayback()) {
            pauseTrack();
            ogPlayerAPI.seekTo(0);
          }

          this.emitCurrentSongInfo(trackUri!);

          // Change volume back to normal
          if (this.volumeChangeEnabled) {
            ogPlayerAPI.setVolume(this.lastVolume);
            this.lastVolume = null;
            this.canChangeVolume = true;
          }
        });
      } else {
        this.client.socket?.emit('changedSong', trackUri);
      }
    }
  }

  onLogin() {
    pauseTrack();
    if (this.volumeChangeEnabled) {
      this.canChangeVolume = true;
      this.lastVolume = Spicetify.Player.getVolume();
      this.ui.bottomMessage('Connected to the server.');
    }
  }

  muteBeforePlay() {
    // Lower volume to 0s
    if (this.volumeChangeEnabled) {
      this.canChangeVolume = false;
      if (this.lastVolume === null)
        this.lastVolume = Spicetify.Player.getVolume();
      ogPlayerAPI.setVolume(0);
    }
  }
}

function compareVersions(a: string, b: string) {
  const left = a.split('.').map((part) => parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}
