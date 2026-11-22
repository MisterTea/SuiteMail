import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {authorizeAndroidGoogle,getAndroidGoogleToken} from './androidGoogleAuth';
const {authorize}=vi.hoisted(()=>({authorize:vi.fn()}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>({authorize})}));
beforeEach(()=>{vi.clearAllMocks();authorize.mockResolvedValue({accessToken:'native-token',expiresIn:600,scopes:['gmail.modify']});});
afterEach(()=>vi.unstubAllGlobals());
const profile=(email='one@gmail.com')=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({email,verified_email:true,name:'One'})}));
describe('Android Google authorization',()=>{
 it('opens a native chooser and identifies the selected account using Google userinfo',async()=>{
  profile();const result=await authorizeAndroidGoogle();
  expect(authorize).toHaveBeenCalledWith({interactive:true,email:undefined});
  expect(fetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:'Bearer native-token'}});
  expect(result.userInfo.email).toBe('one@gmail.com');expect(result.tokens.refresh_token).toBeUndefined();
 });
 it('pins reauthorization to the expected account',async()=>{
  profile();await authorizeAndroidGoogle('one@gmail.com');expect(authorize).toHaveBeenCalledWith({interactive:true,email:'one@gmail.com'});
 });
 it('rejects another account rather than replacing an existing mailbox identity',async()=>{
  profile('other@gmail.com');await expect(authorizeAndroidGoogle('one@gmail.com')).rejects.toThrow('belongs to one@gmail.com');
 });
 it('rejects an unverified identity',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({email:'one@gmail.com',verified_email:false})}));
  await expect(authorizeAndroidGoogle()).rejects.toThrow('verified email');
 });
 it('does not fetch a profile when the user cancels',async()=>{
  authorize.mockRejectedValue(new Error('Google account selection was cancelled.'));profile();
  await expect(authorizeAndroidGoogle()).rejects.toThrow('cancelled');expect(fetch).not.toHaveBeenCalled();
 });
 it('renews each account silently and passes rejected tokens for native cache invalidation',async()=>{
  const now=Math.floor(Date.now()/1000);const result=await getAndroidGoogleToken('two@gmail.com','invalid-token');
  expect(authorize).toHaveBeenCalledWith({interactive:false,email:'two@gmail.com',invalidToken:'invalid-token'});
  expect(result.expiresAt).toBeGreaterThanOrEqual(now+600);
 });
 it('surfaces revoked access without starting interactive consent during sync',async()=>{
  authorize.mockRejectedValue(new Error('Reconnect this Google account in Settings'));
  await expect(getAndroidGoogleToken('one@gmail.com')).rejects.toThrow('Reconnect');
  expect(authorize).toHaveBeenCalledWith({interactive:false,email:'one@gmail.com',invalidToken:undefined});
 });
});
