import type { SceneDef } from '../engine/types';
import aurora from './aurora';
import blackhole from './blackhole';
import embers from './embers';
import fireflies from './fireflies';
import flowfield from './flowfield';
import hearth from './hearth';
import lavalamp from './lavalamp';
import life from './life';
import meteors from './meteors';
import migration from './migration';
import mycelium from './mycelium';
import nebula from './nebula';
import nightcity from './nightcity';
import ocean from './ocean';
import plasma from './plasma';
import probe from './probe';
import rain from './rain';
import reef from './reef';
import starfield from './starfield';
import storm from './storm';
import tokamak from './tokamak';

/** Scene manifest: every scene registers here, and the console lists them automatically. */
export const SCENES: SceneDef[] = [
  aurora, flowfield, plasma, rain, storm, ocean, reef, migration, starfield, meteors, nebula, embers, fireflies, life, mycelium, tokamak, blackhole, nightcity, hearth, lavalamp, probe,
];

export const sceneById = (id: string) => SCENES.find((s) => s.id === id);
export const visibleScenes = (secretUnlocked: boolean) => SCENES.filter((s) => !s.hidden || secretUnlocked);
