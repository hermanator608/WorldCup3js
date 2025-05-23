import * as THREE from 'three'
import grassShader from '../shaders/grass.js';

// Parameters
const PLANE_SIZE = 50;
// const BLADE_COUNT = 200000;
// const BLADE_WIDTH = 0.1;
// const BLADE_HEIGHT = 0.8;
// const BLADE_HEIGHT_VARIATION = 0.6;

// Grass Texture
const grassTexture = new THREE.TextureLoader().load('dark_grass.png');
const cloudTexture = new THREE.TextureLoader().load('cloud.jpg');
cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;

const timeUniform = { type: 'f', value: 0.0 };
const grassUniforms = {
    textures: { value: [grassTexture, cloudTexture] },
    iTime: timeUniform
};

const grassMaterial = new THREE.ShaderMaterial({
    uniforms: grassUniforms,
    vertexShader: grassShader.vert,
    fragmentShader: grassShader.frag,
    vertexColors: true,
    side: THREE.DoubleSide
});

function convertRange(val: number, oldMin: number, oldMax: number, newMin: number, newMax: number) {
    return (((val - oldMin) * (newMax - newMin)) / (oldMax - oldMin)) + newMin;
}

export function generateField(guiVars: any) {
    const positions: any[] = [];
    const uvs: any[] = [];
    const indices: any[] = [];
    const colors: any[] = [];

    for (let i = 0; i < guiVars.BLADE_COUNT; i++) {
        const VERTEX_COUNT = 5;
        const surfaceMin = PLANE_SIZE / 2 * -1;
        const surfaceMax = PLANE_SIZE / 2;

        // Circle of grass
        // const radius = PLANE_SIZE / 2;
        // const r = radius * Math.sqrt(Math.random());
        // const theta = Math.random() * 2 * Math.PI;
        // const x = r * Math.cos(theta);
        // const y = r * Math.sin(theta);

        // Generate random x and z positions within the rectangle
        const x = Math.random() * PLANE_SIZE - PLANE_SIZE / 2;
        const y = Math.random() * PLANE_SIZE - PLANE_SIZE / 2;


        const pos = new THREE.Vector3(x, 0, y);

        const uv = [convertRange(pos.x, surfaceMin, surfaceMax, 0, 1), convertRange(pos.z, surfaceMin, surfaceMax, 0, 1)];

        const blade = generateBlade(guiVars, pos, i * VERTEX_COUNT, uv);
        blade.verts.forEach(vert => {
            positions.push(...vert.pos);
            uvs.push(...vert.uv);
            colors.push(...vert.color);
        });
        blade.indices.forEach(indice => indices.push(indice));
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const grassMesh = new THREE.Mesh(geom, grassMaterial);

    const planeGeometry = new THREE.PlaneGeometry(50, 50)
    const planeMaterial = new THREE.MeshStandardMaterial({ color: "#433e02" })
    planeMaterial.side = THREE.DoubleSide
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    planeMesh.rotation.x = -Math.PI / 2
    return {planeMesh, grassMesh };
}

function generateBlade(guiVars:any, center: THREE.Vector3Like, vArrOffset: any, uv: any) {
    const MID_WIDTH = guiVars.BLADE_WIDTH * 0.5;
    const TIP_OFFSET = 0.1;
    const height = guiVars.BLADE_HEIGHT + (Math.random() * guiVars.BLADE_HEIGHT_VARIATION);

    const yaw = Math.random() * Math.PI * 2;
    const yawUnitVec = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const tipBend = Math.random() * Math.PI * 2;
    const tipBendUnitVec = new THREE.Vector3(Math.sin(tipBend), 0, -Math.cos(tipBend));

    // Find the Bottom Left, Bottom Right, Top Left, Top right, Top Center vertex positions
    const bl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((guiVars.BLADE_WIDTH / 2) * 1));
    const br = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((guiVars.BLADE_WIDTH / 2) * -1));
    const tl = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * 1));
    const tr = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(yawUnitVec).multiplyScalar((MID_WIDTH / 2) * -1));
    const tc = new THREE.Vector3().addVectors(center, new THREE.Vector3().copy(tipBendUnitVec).multiplyScalar(TIP_OFFSET));

    tl.y += height / 2;
    tr.y += height / 2;
    tc.y += height;

    // Vertex Colors
    const black = [0, 0, 0];
    const gray = [0.5, 0.5, 0.5];
    const white = [1.0, 1.0, 1.0];

    const verts = [
        { pos: bl.toArray(), uv: uv, color: black },
        { pos: br.toArray(), uv: uv, color: black },
        { pos: tr.toArray(), uv: uv, color: gray },
        { pos: tl.toArray(), uv: uv, color: gray },
        { pos: tc.toArray(), uv: uv, color: white }
    ];

    const indices = [
        vArrOffset,
        vArrOffset + 1,
        vArrOffset + 2,
        vArrOffset + 2,
        vArrOffset + 4,
        vArrOffset + 3,
        vArrOffset + 3,
        vArrOffset,
        vArrOffset + 2
    ];

    return { verts, indices };
}
