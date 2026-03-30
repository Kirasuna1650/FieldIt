# Field It Mobile

Cross-platform mobile app for Field It, built with Expo + React Native.

## Prerequisites

- Node.js 18+
- npm 9+
- Backend API running from project root on port 3000

## Run in Development

1. Start backend API from project root:

```bash
npm run dev
```

2. Start Expo in another terminal:

```bash
npm run mobile:start
```

3. Open on device/simulator:

```bash
npm run mobile:android
npm run mobile:ios
```

## Download Options

### Option 1: Download via Expo Go (fastest)

Use this for internal testing without publishing app stores.

1. Install Expo Go on your phone:
- Android: https://play.google.com/store/apps/details?id=host.exp.exponent
- iOS: https://apps.apple.com/app/expo-go/id982107779

2. Run:

```bash
npm run mobile:start
```

3. Scan QR code from terminal/Expo UI to download and run the app in Expo Go.

### Option 2: Download Android Installable Build (APK/AAB)

Use this for distributable Android builds.

1. Install EAS CLI:

```bash
npm install -g eas-cli
```

2. Login and configure build:

```bash
cd mobile
eas login
eas build:configure
```

3. Build Android:

```bash
eas build -p android --profile preview
```

4. EAS returns a download URL for the APK/AAB when build completes.

### Option 3: iOS Download via TestFlight

Use this for iPhone distribution.

1. Configure EAS once:

```bash
cd mobile
eas login
eas build:configure
```

2. Build iOS:

```bash
eas build -p ios --profile preview
```

3. Submit to App Store Connect:

```bash
eas submit -p ios
```

4. Invite testers in TestFlight. They can download from Apple TestFlight app.

## Backend URL Notes

- Android emulator: http://10.0.2.2:3000
- iOS simulator: http://localhost:3000
- Physical devices: use your machine LAN IP (example: http://192.168.1.20:3000)

Set this value in the app's Backend Base URL field.

## Current Mobile Features

- API health check
- Pick PDF template from device
- Detect PDF fields from backend
- Send rows JSON payload to generate filled PDF

## Next Suggested Improvements

- Save generated PDF to device storage
- Share generated PDF through native share sheet
- Replace raw rows JSON editor with dynamic form inputs
