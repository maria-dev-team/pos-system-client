import { contextBridge, ipcRenderer } from 'electron';

type CameraContext = {
  accessToken: string;
  registerId: string | null;
};

contextBridge.exposeInMainWorld('camera', {
  setContext: (context: CameraContext | null) => {
    ipcRenderer.send('camera:set-context', context);
  },
});
