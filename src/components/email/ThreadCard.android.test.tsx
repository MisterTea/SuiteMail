import { render, screen, fireEvent, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadCard } from "./ThreadCard";
import type { Thread } from "@/stores/threadStore";

const state = vi.hoisted(()=>({archive:vi.fn(), star:vi.fn(), select:vi.fn(), label:"inbox"}));
vi.mock("@/hooks/useAndroidMobile",()=>({useAndroidMobile:()=>true}));
vi.mock("@/hooks/useRouteNavigation",()=>({useActiveLabel:()=>state.label}));
vi.mock("@dnd-kit/core",()=>({useDraggable:()=>({attributes:{"aria-disabled":true,"aria-roledescription":"draggable"},listeners:{},setNodeRef:vi.fn(),isDragging:false})}));
vi.mock("@/services/emailActions",()=>({archiveThread:state.archive,starThread:state.star}));
vi.mock("@/stores/threadStore",()=>({useThreadStore:Object.assign((selector:(s:unknown)=>unknown)=>selector({selectedThreadIds:new Set(),toggleThreadSelection:state.select,selectThreadRange:vi.fn(),searchQuery:""}),{getState:()=>({selectedThreadIds:new Set()})})}));
vi.mock("@/stores/uiStore",()=>({useUIStore:(selector:(s:unknown)=>unknown)=>selector({emailDensity:"default"})}));
const thread: Thread = {id:"t",accountId:"a",subject:"Touch safety",snippet:"Preview",lastMessageAt:1700000000,messageCount:1,isRead:false,isStarred:false,isPinned:false,isMuted:false,hasAttachments:false,labelIds:["INBOX"],fromName:"Alice",fromAddress:"alice@example.com"};

describe("Android conversation gestures",()=>{
  beforeEach(()=>{vi.clearAllMocks();state.label="inbox";vi.useFakeTimers();});
  afterEach(()=>vi.useRealTimers());
  it("shows today's Gmail millisecond timestamp as a local time",()=>{
    const received = new Date(2026,10,21,14,7,26);
    vi.setSystemTime(new Date(2026,10,21,15,0));
    render(<ThreadCard thread={{...thread,lastMessageAt:received.getTime()}} isSelected={false} onClick={vi.fn()}/>);
    expect(screen.getByText(received.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}))).toBeInTheDocument();
    expect(screen.queryByText("Jul 11")).not.toBeInTheDocument();
  });
  it("continues to support second-based timestamps from other providers",()=>{
    const received = new Date(2026,10,21,14,7,26);
    vi.setSystemTime(new Date(2026,10,21,15,0));
    render(<ThreadCard thread={{...thread,lastMessageAt:Math.floor(received.getTime()/1000)}} isSelected={false} onClick={vi.fn()}/>);
    expect(screen.getByText(received.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}))).toBeInTheDocument();
  });
  it("does not archive during a vertical scroll with horizontal drift",()=>{
    render(<ThreadCard thread={thread} isSelected={false} onClick={vi.fn()}/>);
    const card=screen.getByRole("button",{name:/Unread email from/});
    fireEvent.touchStart(card,{touches:[{clientX:200,clientY:200}]});
    fireEvent.touchMove(card,{touches:[{clientX:80,clientY:400}]});
    fireEvent.touchEnd(card);
    expect(state.archive).not.toHaveBeenCalled();
  });
  it("disables destructive swipe in Trash",()=>{
    state.label="trash";
    render(<ThreadCard thread={{...thread,labelIds:["TRASH"]}} isSelected={false} onClick={vi.fn()}/>);
    const card=screen.getByRole("button",{name:/Unread email from/});
    fireEvent.touchStart(card,{touches:[{clientX:250,clientY:200}]});
    fireEvent.touchMove(card,{touches:[{clientX:80,clientY:200}]});
    act(()=>vi.advanceTimersByTime(510));
    fireEvent.touchEnd(card);
    expect(state.select).not.toHaveBeenCalled();
    expect(state.archive).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
    expect(card).not.toHaveAttribute("aria-disabled","true");
  });
  it("long press selects without opening the conversation",()=>{
    const open=vi.fn();render(<ThreadCard thread={thread} isSelected={false} onClick={open}/>);
    const card=screen.getByRole("button",{name:/Unread email from/});
    fireEvent.touchStart(card,{touches:[{clientX:200,clientY:200}]});
    act(()=>vi.advanceTimersByTime(510));
    fireEvent.touchEnd(card);fireEvent.click(card);
    expect(state.select).toHaveBeenCalledWith("t");expect(open).not.toHaveBeenCalled();
  });
  it("announces the Star toggle state separately from opening mail",()=>{
    const open=vi.fn();render(<ThreadCard thread={{...thread,isStarred:true}} isSelected={false} onClick={open}/>);
    const star=screen.getByRole("button",{name:"Unstar"});
    expect(star).toHaveAttribute("aria-pressed","true");fireEvent.click(star);
    expect(open).not.toHaveBeenCalled();
  });
});
