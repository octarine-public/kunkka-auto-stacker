import "./Translate"

import {
	Ability,
	ArrayExtensions,
	Color,
	Creep,
	EntityManager,
	EventsSDK,
	GameRules,
	GameState,
	GUIInfo,
	Hero,
	kunkka_torrent,
	Menu,
	NeutralSpawnBox,
	RendererSDK,
	TickSleeper,
	Unit,
	Vector2,
	Vector3,
	WardObserver
} from "github.com/octarine-public/wrapper/index"

const entry = Menu.AddEntry("Utility")
const tree = entry.AddNode("Kunkka AutoStacker", "panorama/images/spellicons/kunkka_torrent_png.vtex_c", undefined, 0)

const State = tree.AddToggle("State", false),
	GlobalVisualsState = tree.AddToggle("Show visuals globally", true)
const sleeper = new TickSleeper()
function FindEligibleCamps(
	abil: Ability,
	owner: Unit,
	curTime: number,
	stacking = true
): [NeutralSpawnBox, Creep[], Vector3][] {
	const myVec = owner.VisualPosition,
		castRange = abil.CastRange
	return ArrayExtensions.orderBy(
		GameRules!.NeutralSpawnBoxes.filter(
			spot =>
				!EntityManager.GetEntitiesByClass(Hero).some(ent => spot.Includes(ent.VisualPosition)) &&
				!EntityManager.GetEntitiesByClass(Creep).some(
					ent => !ent.IsNeutral && spot.Includes(ent.VisualPosition)
				) &&
				// sentry inherits from observer, so it's all-in-one
				!EntityManager.GetEntitiesByClass(WardObserver).some(ent => spot.Includes(ent.VisualPosition))
		)
			.map(
				spot =>
					[
						spot,
						EntityManager.GetEntitiesByClass(Creep).filter(
							x => (!x.IsVisible || !x.IsWaitingToSpawn) && x.IsAlive && spot.Includes(x.VisualPosition)
						)
					] as [NeutralSpawnBox, Creep[]]
			)
			.filter(
				([spot, creeps]) =>
					creeps.length !== 0 && !creeps.some(creep => creep.VisualPosition.z + 350 < spot.MaxBounds.z)
			)
			.map(
				([spot, creeps]) =>
					[
						spot,
						creeps,
						creeps
							.reduce((prev, cur) => prev.Add(cur.VisualPosition), new Vector3())
							.DivideScalarForThis(creeps.length)
					] as [NeutralSpawnBox, Creep[], Vector3]
			)
			.filter(([_spot, creeps, center]) => {
				if (creeps.some(creep => center.Distance2D(creep.VisualPosition) > abil.AOERadius + creep.HullRadius)) {
					return false
				}
				if (!stacking) {
					return true
				}
				const time =
					(curTime % 60) -
					(60 -
						(abil.CastPoint +
							abil.ActivationDelay +
							0.7 + // it takes ~0.7sec to raise z coord of creeps
							GameState.Ping / 1000))
				return center.IsInRange(myVec, castRange) && time > 0 && time < 0.15
			}),
		spot => spot[2].Distance2D(myVec)
	)
}
EventsSDK.on("Tick", () => {
	if (!State.value || sleeper.Sleeping || GameRules === undefined || GameRules.IsPaused) {
		return
	}
	const curTime = GameRules.GameTime
	if (curTime < 60) {
		return
	}
	EntityManager.GetEntitiesByClass(kunkka_torrent).forEach(abil => {
		const owner = abil.Owner
		if (owner === undefined || !owner.IsControllable || !abil.CanBeCasted()) {
			return
		}
		const camp = FindEligibleCamps(abil, owner, curTime)[0]
		if (camp !== undefined) {
			const center = camp[2]
			owner.CastPosition(abil, center)
			sleeper.Sleep(abil.GetCastDelay(center, false) + 30)
		}
	})
})
EventsSDK.on("Draw", () => {
	if (!State.value || GameRules === undefined) {
		return
	}
	let stacking: Nullable<Vector3>
	const camps = new Set<Vector3>()
	EntityManager.GetEntitiesByClass(kunkka_torrent).forEach(abil => {
		const owner = abil.Owner
		if (owner === undefined || !owner.IsControllable) {
			return
		}
		const myVec = owner.VisualPosition,
			castRange = abil.CastRange
		FindEligibleCamps(abil, owner, 0, false).forEach(([_spot, _creeps, center]) => {
			if (!GlobalVisualsState.value && !center.IsInRange(myVec, castRange)) {
				return
			}
			stacking ??= center
			camps.add(center)
		})
	})
	const size = new Vector2(GUIInfo.ScaleWidth(20), GUIInfo.ScaleHeight(20))
	const halfSize = size.DivideScalar(2)
	for (const spot of camps) {
		const w2s = RendererSDK.WorldToScreen(spot)
		if (w2s === undefined) {
			continue
		}
		RendererSDK.FilledCircle(
			w2s.Subtract(halfSize),
			size,
			spot === stacking ? (sleeper.Sleeping ? Color.Yellow : Color.Green) : Color.Red
		)
	}
})

EventsSDK.on("GameEnded", () => sleeper.ResetTimer())
