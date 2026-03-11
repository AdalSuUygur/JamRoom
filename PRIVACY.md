# JamRoom Privacy Policy

Last updated: 2026-03-11

## Purpose

JamRoom is a Chrome and Firefox extension designed to synchronize YouTube video playback (play, pause, seek, and video change) between users in the same room. It also supports a shared video queue.

## Data Usage

The extension processes limited technical data required for synchronization:

- Room name entered by the user
- YouTube video URL
- Playback state (play/pause)
- Playback position (timestamp)
- YouTube account display name (used as nickname, if the user is signed in)
- Shared queue entries (YouTube URLs and video titles added by room participants)

This data is used only to provide real-time synchronization and queue management between participants.

## Data Collection

JamRoom does not collect personally identifiable information such as emails, passwords, or financial data. The YouTube display name is read locally from the page and transmitted only to other users in the same room session — it is never stored on any server.

## Data Sharing

Synchronization and queue data is transmitted only to other users connected to the same room through a Socket.IO connection. No data is sent to third-party analytics or advertising services.

## Storage

Basic room information (room name, user count, queue) may be stored locally using Chrome/Firefox storage APIs for session continuity. This data is cleared when the user leaves the room or closes the active tab. No tracking or analytics systems are used.

## Third Parties

JamRoom does not sell user data and does not use data for advertising or analytics purposes. The backend is hosted on Render (render.com); no user data is persisted on the server beyond the active session.

## Contact

For support or privacy questions:
https://github.com/AdalSuUygur/JamRoom/issues