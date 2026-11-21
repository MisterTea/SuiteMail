import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {getGmailClient,initializeClients,reauthorizeAccount,removeClient} from './tokenManager';
const mocks=vi.hoisted(()=>({accounts:vi.fn(),account:vi.fn(),update:vi.fn(),native:vi.fn(),authorize:vi.fn(),setting:vi.fn(),execute:vi.fn()}));
vi.mock('./androidGoogleAuth',()=>({isAndroidGoogle:()=>true,getAndroidGoogleToken:mocks.native,authorizeAndroidGoogle:mocks.authorize}));
vi.mock('../db/accounts',()=>({getAllAccounts:mocks.accounts,getAccount:mocks.account,updateAccountAllTokens:mocks.update}));
vi.mock('../db/settings',()=>({getSetting:mocks.setting,getSecureSetting:mocks.setting}));
vi.mock('../db/connection',()=>({getDb:async()=>({execute:mocks.execute})}));
vi.mock('@/utils/crypto',()=>({encryptValue:async(s:string)=>`encrypted:${s}`}));
beforeEach(()=>{
 vi.clearAllMocks();removeClient('one');removeClient('two');removeClient('imap');
 mocks.accounts.mockResolvedValue([{id:'one',email:'one@gmail.com',provider:'gmail_api',is_active:1,access_token:null,refresh_token:null},{id:'two',email:'two@gmail.com',provider:'gmail_api',is_active:1,access_token:null,refresh_token:null},{id:'imap',email:'imap@example.com',provider:'imap',is_active:1}]);
 mocks.native.mockImplementation(async(email:string)=>({accessToken:email,expiresAt:9999999999}));
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({id:'profile'})}));
});
afterEach(()=>vi.unstubAllGlobals());
describe('Android Google account lifecycle',()=>{
 it('starts accounts with no refresh tokens and renews the correct device account independently',async()=>{
  await initializeClients();await Promise.all([(await getGmailClient('one')).getProfile(),(await getGmailClient('two')).getProfile()]);
  expect(mocks.native).toHaveBeenCalledWith('one@gmail.com',undefined);expect(mocks.native).toHaveBeenCalledWith('two@gmail.com',undefined);expect(mocks.setting).not.toHaveBeenCalled();
 });
 it('reauthorizes the same account without a desktop secret or refresh token',async()=>{
  mocks.account.mockResolvedValue({id:'one',email:'one@gmail.com'});
  mocks.authorize.mockResolvedValue({tokens:{access_token:'new',expires_in:600},userInfo:{email:'one@gmail.com'}});
  await reauthorizeAccount('one','one@gmail.com');expect(mocks.authorize).toHaveBeenCalledWith('one@gmail.com');
  expect(mocks.update).toHaveBeenCalledWith('one','new','',expect.any(Number));expect(mocks.setting).not.toHaveBeenCalled();
 });
 it('preserves mailbox tokens when a different account is returned during reconnection',async()=>{
  mocks.account.mockResolvedValue({id:'one',email:'one@gmail.com'});
  mocks.authorize.mockResolvedValue({tokens:{access_token:'wrong',expires_in:600},userInfo:{email:'two@gmail.com'}});
  await expect(reauthorizeAccount('one','one@gmail.com')).rejects.toThrow('expected one@gmail.com');expect(mocks.update).not.toHaveBeenCalled();
 });
});
