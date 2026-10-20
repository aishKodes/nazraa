import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Connection, RowDataPacket } from "mysql2/promise";
import type { MobileIdentity } from "@/lib/auth/mobile-session";

export async function verifyAudioRoomUpgrade(root: Connection, user: (name: string) => Promise<MobileIdentity>, owner: MobileIdentity) {
  const product = await import("@/lib/db/repositories/mobile-product");
  const rooms = await import("@/lib/db/repositories/mobile-completion");
  const profiles = await import("@/lib/db/repositories/room-profile");
  const social = await import("@/lib/db/repositories/face-live-social");
  const code = `QA_AP_${randomUUID().slice(0, 8)}`;
  const initial = {roomCode: code, kind: "party", title: "QA Original Audio Room", category: "Talk", language: "Hindi", privacy: "public" as const, seatCount: 20, themeIndex: 0, themeEnabled: true};
  await product.createRoom(owner, initial);
  assert.equal((await profiles.ownerRoomProfile(owner)).profile?.title, initial.title);
  const guest = await user("QA Appearance Guest");
  await rooms.joinLiveRoom(guest, code);
  const [roomRows] = await root.query<RowDataPacket[]>("SELECT id FROM live_rooms WHERE room_code = ?", [code]);
  const roomId = roomRows[0].id;
  await root.execute("UPDATE live_room_members SET seat_index = 18, seat_session_id = ?, seat_version = 1 WHERE room_id = ? AND application_user_id = ?", [randomUUID(), roomId, guest.userId]);
  await assert.rejects(rooms.updateRoomSettings(owner, {roomCode: code, seatCount: 10, removePassword: false, resetTopDp: false}), /Free the higher seats/);
  const updated = await rooms.updateRoomSettings(owner, {roomCode: code, title: "QA Saved Audio Room", seatCount: 20, themeIndex: 2, themeEnabled: true, removePassword: false, resetTopDp: false});
  assert.equal(updated.version, 2);
  const [seats] = await root.query<RowDataPacket[]>("SELECT seat_index FROM live_room_members WHERE room_id = ? AND application_user_id = ?", [roomId, guest.userId]);
  assert.equal(Number(seats[0].seat_index), 18);
  const [history] = await root.query<RowDataPacket[]>("SELECT presentation_snapshot FROM live_session_accounting WHERE room_id = ?", [roomId]);
  const snapshot = typeof history[0].presentation_snapshot === "string" ? JSON.parse(history[0].presentation_snapshot) : history[0].presentation_snapshot;
  assert.equal(snapshot.title, initial.title);
  assert.equal(snapshot.themeIndex, 0);
  assert.equal((await profiles.roomPresentation(guest, code)).title, "QA Saved Audio Room");
  const concurrentSnapshots = await Promise.all(Array.from({length:25}, (_, index) => rooms.refreshRoomPresence(index % 2 ? owner : guest, code)));
  assert(concurrentSnapshots.every((snapshot) => snapshot.active), "Concurrent presence reads must preserve active room");
  assert(concurrentSnapshots.some((snapshot) => snapshot.participants?.some((participant) => Number(participant.seatIndex) === 18)), "Presence refresh must retain occupied seat");
  const stranger = await user("QA Appearance Stranger");
  await assert.rejects(profiles.roomPresentation(stranger, code), /Join the room/);
  await assert.rejects(rooms.updateRoomSettings(guest, {roomCode: code, title: "Unauthorized rename", removePassword: false, resetTopDp: false}), /Only the Room Owner/);
  // End the first session, then use the canonical saved owner profile in a
  // second room. Never rename or rewrite the first room's historical snapshot.
  await rooms.finalizeLiveSession(owner, code);
  const saved = (await profiles.ownerRoomProfile(owner)).profile!;
  const nextCode = `QA_AP_${randomUUID().slice(0, 8)}`;
  await product.createRoom(owner, {...initial, ...saved, roomCode: nextCode});
  const nextState = await profiles.roomPresentation(owner, nextCode);
  assert.equal(nextState.title, saved.title);
  assert.equal(nextState.seatCount, saved.seatCount);
  assert.equal(nextState.themeIndex, 2);
  // Six actual users, committed Gift transactions and canonical wallet/ledger
  // writes. No synthetic leaderboard amounts are returned by Flutter.
  const [giftRows] = await root.query<RowDataPacket[]>("SELECT gift_key, coin_price FROM gift_catalog WHERE catalog_type='VIRTUAL_GIFT' AND active=TRUE ORDER BY coin_price LIMIT 1");
  const [ownerRows] = await root.query<RowDataPacket[]>("SELECT public_id FROM application_users WHERE id = ?", [owner.userId]);
  let expectedSession=0;let sender:MobileIdentity|undefined;
  for (let index = 0; index < 6; index++) {
    const fan = await user(`QA Audio Fan ${index}`);
    await rooms.joinLiveRoom(fan, nextCode);
    await root.execute("UPDATE wallet_balances SET available_balance=100000 WHERE owner_type='APPLICATION_USER' AND owner_id=? AND asset_type='COIN'", [fan.userId]);
    const sent=await product.sendGift(fan, {roomCode: nextCode, giftId: String(giftRows[0].gift_key), recipientPublicId: String(ownerRows[0].public_id), quantity: index + 1, clientGiftId: randomUUID()});
    assert(sent.event);expectedSession+=sent.event.diamondValue;sender=fan;
  }
  const ranks = await social.faceLiveSocial(owner, nextCode);
  assert.equal(ranks.daily.length, 5);
  assert.equal(ranks.monthly.length, 5);
  assert.equal(ranks.daily[0].user.name, "QA Audio Fan 5");
  assert.equal(ranks.topFanId, ranks.monthly[0].user.id);
  assert.equal(ranks.sessionDiamonds,expectedSession);
  for (let index = 1; index < ranks.daily.length; index++) assert(ranks.daily[index - 1].diamonds >= ranks.daily[index].diamonds);
  assert(ranks.daily.every((row) => String(row.user.name).startsWith("QA Audio Fan")), "Face gifting must not leak into Party rankings");
  await rooms.joinLiveRoom(guest,nextCode);
  const seatApi=await import('@/lib/db/repositories/mobile-seats');
  await seatApi.actOnRoomSeat(guest,{roomCode:nextCode,action:'request',seatIndex:2});
  const giftId=randomUUID();
  const recipientGift={roomCode:nextCode,giftId:String(giftRows[0].gift_key),recipientPublicId:guest.publicId,quantity:2,clientGiftId:giftId};
  const received=await product.sendGift(sender!,recipientGift);
  await product.sendGift(sender!,recipientGift);
  assert(received.event);expectedSession+=received.event.diamondValue;
  const after=await social.faceLiveSocial(owner,nextCode);
  assert.equal(after.sessionDiamonds,expectedSession,'Host and seated participant gifts aggregate; replay counts once');
  assert.equal(after.monthlyDiamonds,ranks.monthlyDiamonds,'Host personal/monthly ranking remains unchanged');
  await rooms.leaveLiveRoom(guest,nextCode);
  await rooms.joinLiveRoom(guest,nextCode);
  assert.equal((await social.faceLiveSocial(guest,nextCode)).sessionDiamonds,expectedSession,'late entry/rejoin restores authoritative total');
  await rooms.finalizeLiveSession(owner, nextCode);
  const fresh=`QA_AP_${randomUUID().slice(0,8)}`;
  await product.createRoom(owner,{...initial,roomCode:fresh});
  assert.equal((await social.faceLiveSocial(owner,fresh)).sessionDiamonds,0,'new session excludes historical gifts');
  await rooms.finalizeLiveSession(owner,fresh);
  console.log("PASS Audio Room: persistent owner profile, immutable history, live title/theme/layout version, occupied-seat safety, member/owner authorization, six real Gift senders, Daily/Monthly Top5 and canonical Top Fan with Face/Party isolation");
}
