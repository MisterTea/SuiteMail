import{render,screen,fireEvent,waitFor}from'@testing-library/react';
import{beforeEach,describe,it,expect,vi}from'vitest';
import{AndroidBackgroundSyncSettings}from'./AndroidBackgroundSyncSettings';
const m=vi.hoisted(()=>({android:vi.fn(),status:vi.fn(),configure:vi.fn()}));
vi.mock('@/services/gmail/androidBackgroundSync',()=>({hasAndroidBackgroundSync:m.android,getBackgroundMailStatus:m.status,setBackgroundMailEnabled:m.configure}));
const status={enabled:true,intervalMinutes:30,lastAttempt:0,lastSuccess:0,lastError:'',queuedThreads:0};
beforeEach(()=>{vi.clearAllMocks();m.android.mockReturnValue(true);m.status.mockResolvedValue(status);m.configure.mockResolvedValue({...status,enabled:false});});
describe('Android background mail settings',()=>{
 it('lets the user disable periodic checks and reflects the saved native setting',async()=>{
  render(<AndroidBackgroundSyncSettings/>);const toggle=screen.getByRole('checkbox');await waitFor(()=>expect(toggle).toBeEnabled());expect(toggle).toBeChecked();fireEvent.click(toggle);
  await waitFor(()=>expect(m.configure).toHaveBeenCalledWith(false));await waitFor(()=>expect(toggle).not.toBeChecked());
 });
 it('explains when background authorization needs reconnection',async()=>{
  m.status.mockResolvedValue({...status,lastError:'reconnect'});render(<AndroidBackgroundSyncSettings/>);expect(await screen.findByRole('status')).toHaveTextContent('Reconnect your Google account');
 });
 it('does not query Android plugins on desktop',()=>{
  m.android.mockReturnValue(false);const{container}=render(<AndroidBackgroundSyncSettings/>);expect(container).toBeEmptyDOMElement();expect(m.status).not.toHaveBeenCalled();
 });
});
