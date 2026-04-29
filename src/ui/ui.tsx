import React from 'react';
import ReactDOM from 'react-dom';
import LTPlayer from '../ltPlayer';
import BottomInfo from './bottomInfo';
import { Popup } from './popup';
import iconSvg from './ListenTogetherIcon';
import pJson from '../../package.json';
import {
  buildSessionInviteUrl,
  parseSessionTarget,
} from '../utils/sessionUrl';

import '../css/ui.scss';

export default class UI {
  bottomInfoContainer: Element | null = null;

  constructor(public ltPlayer: LTPlayer) {
    new Spicetify.Topbar.Button('Listen Together', iconSvg, () =>
      this.openMenu(),
    );

    let loop = setInterval(() => {
      let playingBar = document
        .getElementsByClassName('main-nowPlayingBar-nowPlayingBar')
        .item(0);
      if (playingBar) {
        clearInterval(loop);
        this.bottomInfoContainer = document.createElement('div');
        this.bottomInfoContainer.id = 'listenTogether-bottomInfo';
        playingBar.appendChild(this.bottomInfoContainer);
        this.renderBottomInfo(<BottomInfo server="" />);
      }
    }, 100);
  }

  songRequestPopup(
    trackName: string,
    fromListener: string,
    permitted: () => void,
  ) {
    Popup.create(
      'Listen Together',
      (btn) => {
        if (btn === 'Play') permitted();
        Popup.close();
      },
      ['Play'],
      [<Popup.Text text={`${fromListener} wants to play "${trackName}".`} />],
    );
  }

  openMenu() {
    const connected = this.ltPlayer.client.connected || this.ltPlayer.client.connecting;
    Popup.create(
      'Listen Together',
      () => Popup.close(),
      [],
      [
        <Popup.Button
          text={connected ? 'Leave session' : 'Join session'}
          onClick={() => this.onClickJoinASession()}
        />,
        <Popup.Button
          text={'Create session'}
          onClick={() => this.onClickCreateSession()}
        />,
        <Popup.Button
          text={this.ltPlayer.isHost ? 'Stop hosting' : 'Request host'}
          onClick={() => this.onClickRequestHost()}
          disabled={!this.ltPlayer.client.connected}
        />,
        <Popup.Button
          text={'Session settings'}
          onClick={() => this.onClickSessionSettings()}
          disabled={!this.ltPlayer.client.connected}
        />,
        <Popup.Button
          text={'Copy invite URL'}
          onClick={() => this.onClickCopyInvite()}
          disabled={!this.ltPlayer.settingsManager.settings.sessionId}
        />,
        <Popup.Button
          text={'Plugin settings'}
          onClick={() => this.onClickPluginSettings()}
        />,
        <Popup.Button text={'About'} onClick={() => this.onClickAbout()} />,
      ],
    );
  }

  windowMessage(message: string) {
    Popup.create(
      'Listen Together',
      () => Popup.close(),
      ['OK'],
      [<Popup.Text text={message} />],
    );
  }

  bottomMessage(message: string) {
    Spicetify.showNotification(message);
  }

  disconnectedPopup() {
    Popup.create(
      'Listen Together',
      (btn) => {
        if (btn === 'Reconnect') {
          this.ltPlayer.client.connect();
        }
        Popup.close();
      },
      ['Reconnect'],
      [<Popup.Text text={'Disconnected from the session.'} />],
    );
  }

  updateAvailablePopup(version: string, updateUrl: string) {
    Popup.create(
      'Listen Together Update',
      (btn) => {
        if (btn === 'Update') {
          window.location.href = updateUrl;
        }

        if (btn === 'Remind me later') {
          this.ltPlayer.remindUpdateLater(version);
          this.bottomMessage('Listen Together update reminder paused.');
        }

        Popup.close();
      },
      ['Update', 'Remind me later'],
      [
        <Popup.Text
          text={`Listen Together v${version} is available. You are running v${pJson.version}.`}
        />,
      ],
    );
  }

  quickConnect(address: string) {
    const target = parseSessionTarget(address);
    const settings = this.ltPlayer.settingsManager.settings;

    if (!target.server) {
      return;
    }

    if (
      !this.ltPlayer.client.connected &&
      !this.ltPlayer.client.connecting
    ) {
      settings.server = target.server;
      if (target.sessionId) {
        settings.sessionId = target.sessionId;
      }
      this.ltPlayer.settingsManager.saveSettings();

      if (!settings.name) {
        this.onClickJoinASession();
      } else {
        this.ltPlayer.client.connect(target.server);
      }
    }
  }

  private onClickJoinASession() {
    if (this.ltPlayer.client.connected || this.ltPlayer.client.connecting) {
      this.ltPlayer.client.disconnect();
      return;
    }

    this.joinSessionPopup((btn, address, sessionId, name, autoConnect) => {
      if (btn === 'Host a server') {
        window.location.href =
          'https://render.com/deploy?repo=https://github.com/NekoSuneProjects/spotify-listen-together-server';
        return;
      }

      const target = parseSessionTarget(address);
      const server = target.server || address.trim();
      const nextSessionId = sessionId.trim() || target.sessionId;

      Popup.close();
      if (!!server && !!name) {
        this.ltPlayer.settingsManager.settings.server = server;
        this.ltPlayer.settingsManager.settings.sessionId = nextSessionId;
        this.ltPlayer.settingsManager.settings.name = name;
        this.ltPlayer.settingsManager.settings.autoConnect = autoConnect;
        this.ltPlayer.settingsManager.saveSettings();
        this.ltPlayer.client.connect(server);
      }
    });
  }

  private onClickCreateSession() {
    this.createSessionPopup(async (
      serverInput,
      sessionName,
      displayName,
      password,
      isPublic,
      autoConnect,
    ) => {
      const target = parseSessionTarget(serverInput);
      const server = target.server || serverInput.trim();

      if (!server || !password || !displayName) {
        this.windowMessage('Server, display name, and host password are required.');
        return;
      }

      try {
        const session = await this.ltPlayer.client.createSession(
          server,
          sessionName,
          isPublic,
          password,
        );

        const settings = this.ltPlayer.settingsManager.settings;
        settings.server = server;
        settings.sessionId = session.id;
        settings.sessionName = session.name;
        settings.sessionPublic = session.isPublic;
        settings.name = displayName;
        settings.password = password;
        settings.autoConnect = autoConnect;
        this.ltPlayer.settingsManager.saveSettings();

        Popup.close();
        if (this.ltPlayer.client.connected || this.ltPlayer.client.connecting) {
          this.ltPlayer.client.disconnect(false);
        }
        this.ltPlayer.client.connect(server);
      } catch (error: any) {
        this.windowMessage(error?.message || 'Session could not be created.');
      }
    });
  }

  private onClickRequestHost() {
    if (this.ltPlayer.client.connected) {
      if (this.ltPlayer.isHost) {
        this.ltPlayer.client.socket?.emit('cancelHost');
        Popup.close();
      } else {
        this.requestHostPopup((password) => {
          if (!!password) {
            this.ltPlayer.client.socket?.emit('requestHost', password);
            this.ltPlayer.settingsManager.settings.password = password;
            this.ltPlayer.settingsManager.saveSettings();
          }
          Popup.close();
        });
      }
    } else {
      this.windowMessage('Please connect to a session before requesting host.');
    }
  }

  private onClickSessionSettings() {
    if (!this.ltPlayer.client.connected) {
      this.windowMessage('Please connect to a session first.');
      return;
    }

    let sessionName = this.ltPlayer.settingsManager.settings.sessionName || 'Listen Together Session';
    let isPublic = this.ltPlayer.settingsManager.settings.sessionPublic;
    Popup.create(
      'Session Settings',
      (btn) => {
        if (btn !== 'Save') {
          Popup.close();
          return;
        }

        this.ltPlayer.client.socket?.emit(
          'updateSession',
          { name: sessionName, isPublic },
          (response: any) => {
            if (!response?.ok) {
              this.windowMessage(response?.error || 'Session update failed.');
              return;
            }

            const settings = this.ltPlayer.settingsManager.settings;
            settings.sessionName = response.session.name;
            settings.sessionPublic = response.session.isPublic;
            this.ltPlayer.settingsManager.saveSettings();
            this.bottomMessage('Session settings updated.');
            Popup.close();
          },
        );
      },
      ['Save'],
      [
        <Popup.Textbox
          name="Session name"
          defaultValue={sessionName}
          onInput={(text) => (sessionName = text)}
        />,
        <Popup.Checkbox
          label="Public session"
          defaultChecked={isPublic}
          onChange={(checked) => (isPublic = checked)}
        />,
      ],
    );
  }

  private onClickCopyInvite() {
    const settings = this.ltPlayer.settingsManager.settings;
    const inviteUrl = buildSessionInviteUrl(settings.server, settings.sessionId);

    if (!inviteUrl) {
      this.windowMessage('No session invite URL is available yet.');
      return;
    }

    navigator.clipboard?.writeText(inviteUrl);
    this.bottomMessage('Listen Together invite URL copied.');
    Popup.close();
  }

  private onClickPluginSettings() {
    const settings = this.ltPlayer.settingsManager.settings;
    let updateNotifications = settings.updateNotifications;
    let autoOpenUpdatePage = settings.autoOpenUpdatePage;

    Popup.create(
      'Plugin Settings',
      (btn) => {
        settings.updateNotifications = updateNotifications;
        settings.autoOpenUpdatePage = autoOpenUpdatePage;
        this.ltPlayer.settingsManager.saveSettings();

        if (btn === 'Check now') {
          this.ltPlayer.checkForUpdates(true);
        } else {
          this.bottomMessage('Listen Together settings saved.');
        }

        Popup.close();
      },
      ['Save', 'Check now'],
      [
        <Popup.Checkbox
          label="Notify when updates are available"
          defaultChecked={updateNotifications}
          onChange={(checked) => (updateNotifications = checked)}
        />,
        <Popup.Checkbox
          label="Open update page automatically"
          defaultChecked={autoOpenUpdatePage}
          onChange={(checked) => (autoOpenUpdatePage = checked)}
        />,
      ],
    );
  }

  private onClickAbout() {
    Popup.create(
      'Listen Together',
      () => {
        Popup.close();
      },
      [],
      [
        <Popup.Text
          text={`Listen Together v${pJson.version} created by NekoSuneProjects fork of FlafyDev`}
          centered={false}
        />,
        <Popup.Button
          text={'Github'}
          onClick={() =>
            (window.location.href =
              'https://github.com/NekoSuneProjects/spotify-listen-together')
          }
        />,
      ],
    );
  }

  private joinSessionPopup(
    callback: (
      btn: string | null,
      address: string,
      sessionId: string,
      name: string,
      autoConnect: boolean,
    ) => void,
  ) {
    let address = '';
    let sessionId = '';
    let name = '';
    let autoConnect = false;
    const settings = this.ltPlayer.settingsManager.settings;
    Popup.create(
      'Join Session',
      (btn) => callback(btn, address, sessionId, name, autoConnect),
      ['Join', 'Host a server'],
      [
        <Popup.Textbox
          name="Server or invite URL"
          example="https://www.server.com/session/abc"
          defaultValue={settings.server}
          onInput={(text) => {
            address = text;
          }}
        />,
        <Popup.Textbox
          name="Session ID"
          example="leave blank for main"
          defaultValue={settings.sessionId}
          onInput={(text) => {
            sessionId = text;
          }}
        />,
        <Popup.Textbox
          name="Your name"
          example="Joe"
          defaultValue={settings.name}
          onInput={(text) => {
            name = text;
          }}
        />,
        <Popup.Checkbox
          label="Autoconnect"
          defaultChecked={settings.autoConnect}
          onChange={(checked) => {
            autoConnect = checked;
          }}
        />,
      ],
    );
  }

  private createSessionPopup(
    callback: (
      server: string,
      sessionName: string,
      displayName: string,
      password: string,
      isPublic: boolean,
      autoConnect: boolean,
    ) => void,
  ) {
    const settings = this.ltPlayer.settingsManager.settings;
    let server = settings.server;
    let sessionName = settings.sessionName || 'Listen Together Session';
    let displayName = settings.name;
    let password = settings.password;
    let isPublic = settings.sessionPublic;
    let autoConnect = settings.autoConnect;

    Popup.create(
      'Create Session',
      (btn) => {
        if (btn === 'Create') {
          callback(server, sessionName, displayName, password, isPublic, autoConnect);
        } else {
          Popup.close();
        }
      },
      ['Create'],
      [
        <Popup.Textbox
          name="Server address"
          example="https://www.server.com"
          defaultValue={server}
          onInput={(text) => (server = text)}
        />,
        <Popup.Textbox
          name="Session name"
          example="VRChat Dance Night"
          defaultValue={sessionName}
          onInput={(text) => (sessionName = text)}
        />,
        <Popup.Textbox
          name="Your name"
          example="Joe"
          defaultValue={displayName}
          onInput={(text) => (displayName = text)}
        />,
        <Popup.Textbox
          name="Host password"
          defaultValue={password}
          onInput={(text) => (password = text)}
        />,
        <Popup.Checkbox
          label="Public session"
          defaultChecked={isPublic}
          onChange={(checked) => (isPublic = checked)}
        />,
        <Popup.Checkbox
          label="Autoconnect"
          defaultChecked={autoConnect}
          onChange={(checked) => (autoConnect = checked)}
        />,
      ],
    );
  }

  private requestHostPopup(callback: (password: string) => void) {
    let password = '';
    Popup.create(
      'Listen Together',
      () => callback(password),
      ['Request'],
      [
        <Popup.Text text="Request host" />,
        <Popup.Textbox
          name="Password"
          defaultValue={this.ltPlayer.settingsManager.settings.password}
          onInput={(text) => (password = text)}
        />,
      ],
    );
  }

  convertJSXToString(jsxElement: JSX.Element): string {
    const element = React.createElement(React.Fragment, null, jsxElement);
    const container = document.createElement('div');
    ReactDOM.render(element, container);
    const htmlString = container.innerHTML;
    ReactDOM.unmountComponentAtNode(container);
    return htmlString;
  }

  renderBottomInfo(bottomInfo: JSX.Element) {
    if (this.bottomInfoContainer) {
      const htmlString = this.convertJSXToString(bottomInfo);
      this.bottomInfoContainer.innerHTML = htmlString;
    }
  }
}
