import { io, Socket } from 'socket.io-client';
import LTPlayer from './ltPlayer';
import React from 'react';
import BottomInfo from './ui/bottomInfo';
import {
  forcePlay,
  forcePlayTrack,
  getCurrentTrackUri,
  getTrackType,
  isListenableTrackType,
} from './utils/spotifyUtils';
import { buildApiUrl, parseSessionTarget } from './utils/sessionUrl';

type SessionInfo = {
  id: string;
  name: string;
  isPublic: boolean;
  url: string;
};

export default class Client {
  connecting = false;
  connected = false;
  socket: Socket | null = null;
  server = '';

  constructor(public ltPlayer: LTPlayer) {
    setInterval(async () => {
      if (this.connected) {
        try {
          await fetch(this.server);
        } catch {}
      }
    }, 5 * 60_000);
  }

  connect(server?: string) {
    if (!server) server = this.ltPlayer.settingsManager.settings.server;

    const target = parseSessionTarget(server);
    if (target.server) {
      server = target.server;
    }

    if (target.sessionId) {
      this.ltPlayer.settingsManager.settings.sessionId = target.sessionId;
      this.ltPlayer.settingsManager.saveSettings();
    }

    if (getCurrentTrackUri() != '') {
      forcePlayTrack('');
      setTimeout(() => this.connect(server), 100);
      return;
    }

    this.server = server;

    this.connecting = true;
    this.ltPlayer.ui.renderBottomInfo(
      <BottomInfo server={server} loading={true} />,
    );
    // this.ltPlayer.ui.menuItems.joinServer?.setName("Leave the server")

    this.socket = io(server, {
      secure: true,
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 5000,
      randomizationFactor: 0.5,
      auth: {
        sessionId: this.ltPlayer.settingsManager.settings.sessionId,
      },
      query: {
        sessionId: this.ltPlayer.settingsManager.settings.sessionId,
      },
    });

    this.socket.on('connect', () => {
      this.ltPlayer.ui.renderBottomInfo(<BottomInfo server={server!} />);
      this.ltPlayer.checkForUpdates();
      this.connecting = false;
      this.connected = true;
      this.ltPlayer.isHost = false;
      this.socket!.emit(
        'login',
        this.ltPlayer.settingsManager.settings.name,
        this.ltPlayer.version,
        (versionRequirements: string) => {
          this.socket?.disconnect();
          setTimeout(
            () =>
              this.ltPlayer.ui.windowMessage(
                `Your Spotify Listen Together's version isn't compatible with the server's version. Consider switching to a version that meets these requirements: "${versionRequirements}".`,
              ),
            1,
          );
        },
      );

      // Initialize ltPlayer (patching, etc.)
      this.ltPlayer.init();
      this.ltPlayer.onLogin();

      // Try to request host if password is set
      const password = this.ltPlayer.settingsManager.settings.password;
      if (password != '') {
        this.socket!.emit('requestHost', password);
      }
    });

    this.socket.on('sessionInfo', (session: SessionInfo) => {
      this.ltPlayer.settingsManager.settings.sessionId = session.id;
      this.ltPlayer.settingsManager.settings.sessionName = session.name;
      this.ltPlayer.settingsManager.settings.sessionPublic = session.isPublic;
      this.ltPlayer.settingsManager.saveSettings();
      this.ltPlayer.ui.renderBottomInfo(
        <BottomInfo server={server!} session={session} />,
      );
    });

    this.socket.onAny((ev: string, ...args: any[]) => {
      const formattedArgs = args.map((arg) => {
        if (typeof arg === 'object' && arg !== null) {
          return JSON.stringify(arg, null, 2);
        } else if (typeof arg === 'string') {
          return `"${arg}"`;
        } else if (typeof arg === 'function') {
          return arg.toString();
        } else {
          return String(arg);
        }
      });

      const argsString = formattedArgs.join(', ');
      console.log(`Receiving event "${ev}" with args: ${argsString}`);
    });

    this.socket.on('changeSong', (trackUri: string) => {
      if (isListenableTrackType(getTrackType(trackUri)))
        this.ltPlayer.onChangeSong(trackUri);
    });

    this.socket.on('updateSong', (pause: boolean, milliseconds: number) => {
      if (isListenableTrackType())
        this.ltPlayer.onUpdateSong(pause, milliseconds);
    });

    this.socket.on('bottomMessage', (message: string) => {
      this.ltPlayer.ui.bottomMessage(message);
    });

    this.socket.on('windowMessage', (message: string) => {
      this.ltPlayer.ui.windowMessage(message);
    });

    this.socket.on('listeners', (clients: any) => {
      this.ltPlayer.ui.renderBottomInfo(
        <BottomInfo
          server={server!}
          listeners={clients}
          session={{
            id: this.ltPlayer.settingsManager.settings.sessionId,
            name: this.ltPlayer.settingsManager.settings.sessionName,
            isPublic: this.ltPlayer.settingsManager.settings.sessionPublic,
            url: '',
          }}
        />,
      );
    });

    this.socket.on('isHost', (isHost: boolean) => {
      if (isHost != this.ltPlayer.isHost) {
        this.ltPlayer.isHost = isHost;
        if (isHost) {
          // this.ltPlayer.ui.menuItems.requestHost?.setName("Cancel hosting");
          this.ltPlayer.ui.bottomMessage('You are now a host.');
        } else {
          // this.ltPlayer.ui.menuItems.requestHost?.setName("Request host");
          this.ltPlayer.ui.bottomMessage('You are no longer a host.');
        }
      }
    });

    this.socket.on(
      'songRequested',
      (trackUri: string, trackName: string, fromListener: string) => {
        this.ltPlayer.ui.songRequestPopup(trackName, fromListener, () => {
          forcePlayTrack(trackUri);
        });
      },
    );

    // Synchronize the queue on join
    this.socket.on('queueUpdate', (queue: Spicetify.ContextTrack[]) => {
      console.dir(`Queue updated: ${queue || 'empty'}`, { depth: null });
      this.ltPlayer.onQueueUpdate(queue);
    });

    this.socket.on('addToQueue', (items: Spicetify.ContextTrack[]) => {
      this.ltPlayer.onAddToQueue(items);
    });

    this.socket.on('removeFromQueue', (items: Spicetify.ContextTrack[]) => {
      this.ltPlayer.onRemoveFromQueue(items);
    });

    this.socket.on('clearQueue', () => {
      this.ltPlayer.onClearQueue();
    });

    this.socket.on('sessionDeleted', () => {
      this.ltPlayer.ui.windowMessage(
        'This Listen Together session was deleted because it had no listeners for more than five minutes.',
      );
      this.disconnect();
    });

    this.socket.on('adminSkipToNext', () => {
      if (this.ltPlayer.canControlPlayback()) {
        this.ltPlayer.skipToNextTrack();
      }
    });

    this.socket.on('playbackLeader', (isPlaybackLeader: boolean) => {
      this.ltPlayer.isPlaybackLeader = isPlaybackLeader;
    });

    this.socket.on('adminPlayTrack', (trackUri: string) => {
      if (this.ltPlayer.canControlPlayback() && trackUri) {
        forcePlayTrack(trackUri);
      }
    });

    this.socket.on('adminPlayFallback', (contextUri: string) => {
      if (this.ltPlayer.canControlPlayback() && contextUri) {
        forcePlay({ uri: contextUri }, {}, {});
      }
    });

    this.socket.on('connect_error', () => {
      console.log('Connection error.');
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`Disconnected: ${reason}`);
      if (reason === 'io server disconnect') {
        this.connect(this.server);
      } else if (reason === 'io client disconnect') {
        if (this.socket) {
          this.disconnect();
        }
      }
    });

    this.socket.on('error', () => {
      console.log('Error connecting to the server.');
      this.disconnect();
      this.ltPlayer.ui.windowMessage(`Couldn't connect to "${server}".`);
    });
  }

  disconnect(showPopup = true) {
    const socket = this.socket;
    this.socket = null;
    socket?.disconnect();
    this.connected = false;
    this.ltPlayer.isHost = false;
    this.connecting = false;
    this.ltPlayer.unload();
    // this.ltPlayer.ui.menuItems.joinServer?.setName("Join a server")
    // this.ltPlayer.ui.menuItems.requestHost?.setName("Request host");
    this.ltPlayer.ui.renderBottomInfo(<BottomInfo server={''} />);
    if (showPopup) {
      this.ltPlayer.ui.disconnectedPopup();
    }
  }

  async createSession(
    server: string,
    sessionName: string,
    isPublic: boolean,
    hostPassword: string,
  ) {
    const response = await fetch(buildApiUrl(server, '/api/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sessionName,
        isPublic,
        hostPassword,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || 'Session could not be created.');
    }

    return data.session as SessionInfo;
  }
}
