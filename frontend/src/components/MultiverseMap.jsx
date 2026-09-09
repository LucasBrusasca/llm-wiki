import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/* ══════════════════════════════════════════════════════════════════════════
   MULTIVERSO — Glass Tesseract (Final Version)
   
   HARD CAPS:
   - Bloom strength ≤ 0.25 (using 0.2)
   - Colors: WHITE / CYAN ONLY — no rainbow
   - Sharp readable edges — not blobs
   - Visible graph inside each cube
   - Labels in HTML overlay
   ══════════════════════════════════════════════════════════════════════════ */

// HARD CAP: Only white/cyan palette
const EDGE_COLOR = new THREE.Color(0xFFFFFF);      // Pure white
const EDGE_COLOR_INNER = new THREE.Color(0x88DDFF); // Light cyan
const GLOW_COLOR = new THREE.Color(0x00CCFF);       // Cyan glow
const GRAPH_NODE_COLOR = new THREE.Color(0x00EEFF); // Cyan nodes

// HARD CAP: Bloom strength
const BLOOM_STRENGTH = 0.2;  // MAX 0.25, using 0.2 for subtle glow
const BLOOM_RADIUS = 0.3;
const BLOOM_THRESHOLD = 0.5;

export default function MultiverseMap({
  sections,
  onSelectSection,
  onClose,
  currentSection
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const cubeGroupsRef = useRef([]);
  const rafRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [focusedCube, setFocusedCube] = useState(null);
  const [sectionData, setSectionData] = useState({});
  const [labels, setLabels] = useState([]);
  const [hintText, setHintText] = useState('Orbita para explorar · Click en un cubo para enfocar');

  // Load graph data
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      const data = {};
      
      for (const section of sections) {
        try {
          const r = await fetch(`/api/graph?seccion=${encodeURIComponent(section.nombre)}`);
          const json = await r.json();
          const nodes = (json.nodos || []).slice(0, 60).map(n => ({
            id: n.id,
            x: (n.x3d ?? (Math.random() - 0.5)) * 2,
            y: (n.y3d ?? (Math.random() - 0.5)) * 2,
            z: (n.z3d ?? (Math.random() - 0.5)) * 2,
          }));
          const links = (json.relaciones || []).slice(0, 80);
          data[section.nombre] = { nodes, links, count: json.nodos?.length || 0 };
        } catch {
          data[section.nombre] = { nodes: [], links: [], count: section.count || 0 };
        }
      }
      
      setSectionData(data);
      setLoading(false);
    };
    
    loadData();
  }, [sections]);

  // Three.js scene
  useEffect(() => {
    if (!containerRef.current || loading) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(10, 7, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true, 
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Post-processing with CAPPED bloom
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      BLOOM_STRENGTH,  // HARD CAP: 0.2
      BLOOM_RADIUS,
      BLOOM_THRESHOLD
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 35;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404050, 0.4);
    scene.add(ambientLight);

    const light1 = new THREE.DirectionalLight(0xFFFFFF, 0.8);
    light1.position.set(10, 15, 10);
    scene.add(light1);

    const light2 = new THREE.DirectionalLight(0x88CCFF, 0.5);
    light2.position.set(-10, -5, -10);
    scene.add(light2);

    // Create tesseract structure
    cubeGroupsRef.current = [];
    const labelData = createTesseractStructure(scene, sections, sectionData, currentSection);
    setLabels(labelData);

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const handleClick = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(cubeGroupsRef.current, true);

      if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj && !obj.userData.sectionName) {
          obj = obj.parent;
        }
        if (obj?.userData.sectionName) {
          handleCubeClick(obj.userData.sectionName);
        }
      }
    };

    renderer.domElement.addEventListener('click', handleClick);

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      
      controls.update();
      
      // Update HTML labels position
      updateLabelsPosition(camera, cubeGroupsRef.current, container);
      
      // Subtle animation
      cubeGroupsRef.current.forEach((group, i) => {
        if (group.userData.innerGroup) {
          group.userData.innerGroup.rotation.y = time * 0.08 + i * 0.5;
        }
      });

      composer.render();
    };
    animate();

    // Resize
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('click', handleClick);
      cancelAnimationFrame(rafRef.current);
      controls.dispose();
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [loading, sections, sectionData, currentSection]);

  // Create tesseract structure
  const createTesseractStructure = useCallback((scene, sections, data, currentSection) => {
    const count = sections.length;
    const labelData = [];
    
    // Positions in tesseract arrangement
    const spacing = 5;
    const positions = [];
    
    if (count === 1) {
      positions.push(new THREE.Vector3(0, 0, 0));
    } else if (count === 2) {
      positions.push(new THREE.Vector3(-spacing/2, 0, 0));
      positions.push(new THREE.Vector3(spacing/2, 0, 0));
    } else if (count <= 4) {
      const offsets = [[-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1]];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i];
        positions.push(new THREE.Vector3(x * spacing/2, y, z * spacing/2));
      }
    } else {
      const offsets = [
        [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
        [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
      ];
      for (let i = 0; i < count; i++) {
        const [x, y, z] = offsets[i % 8];
        positions.push(new THREE.Vector3(x * spacing/2, y * spacing/2, z * spacing/2));
      }
    }

    // Create each cube
    sections.forEach((section, i) => {
      const pos = positions[i];
      const isCurrent = section.nombre === currentSection;
      const graphData = data[section.nombre];
      
      const cubeGroup = createGlassCube(pos, 3, section.nombre, isCurrent, graphData);
      scene.add(cubeGroup);
      cubeGroupsRef.current.push(cubeGroup);
      
      labelData.push({
        name: section.nombre,
        count: graphData?.count || 0,
        position: pos.clone(),
        isCurrent,
      });
    });

    // Connect cubes with subtle beams
    createConnections(scene, positions);
    
    return labelData;
  }, []);

  // Create a single glass tesseract cube
  const createGlassCube = (position, size, sectionName, isCurrent, graphData) => {
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.sectionName = sectionName;
    
    const innerGroup = new THREE.Group();
    group.userData.innerGroup = innerGroup;

    // === OUTER CUBE ===
    
    // Glass faces
    const glassGeometry = new THREE.BoxGeometry(size, size, size);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x112233,
      transparent: true,
      opacity: 0.08,
      roughness: 0.1,
      metalness: 0.0,
      transmission: 0.92,
      thickness: 0.3,
      ior: 1.1,
      side: THREE.DoubleSide,
    });
    const glassCube = new THREE.Mesh(glassGeometry, glassMaterial);
    innerGroup.add(glassCube);

    // Sharp white edges (EdgesGeometry for crisp lines)
    const edgesGeometry = new THREE.EdgesGeometry(glassGeometry);
    const edgesMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.95,
    });
    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    innerGroup.add(edges);

    // === INNER CUBE ===
    const innerSize = size * 0.4;
    
    const innerGlassGeometry = new THREE.BoxGeometry(innerSize, innerSize, innerSize);
    const innerGlassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x223344,
      transparent: true,
      opacity: 0.1,
      transmission: 0.9,
      side: THREE.DoubleSide,
    });
    const innerGlass = new THREE.Mesh(innerGlassGeometry, innerGlassMaterial);
    innerGroup.add(innerGlass);

    // Inner cube edges (cyan)
    const innerEdgesGeometry = new THREE.EdgesGeometry(innerGlassGeometry);
    const innerEdgesMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR_INNER,
      transparent: true,
      opacity: 0.85,
    });
    const innerEdges = new THREE.LineSegments(innerEdgesGeometry, innerEdgesMaterial);
    innerGroup.add(innerEdges);

    // === DIAGONAL VERTEX CONNECTORS ===
    const vertices = [
      [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
    ];
    
    const diagonalPositions = [];
    vertices.forEach(([x, y, z]) => {
      diagonalPositions.push(
        x * size/2, y * size/2, z * size/2,
        x * innerSize/2, y * innerSize/2, z * innerSize/2
      );
    });
    
    const diagonalGeometry = new THREE.BufferGeometry();
    diagonalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(diagonalPositions, 3));
    const diagonalMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR_INNER,
      transparent: true,
      opacity: 0.5,
    });
    const diagonals = new THREE.LineSegments(diagonalGeometry, diagonalMaterial);
    innerGroup.add(diagonals);

    // === GRAPH NODES INSIDE ===
    if (graphData?.nodes?.length > 0) {
      const graphGroup = createGraphInside(graphData, innerSize * 0.8);
      innerGroup.add(graphGroup);
    }

    group.add(innerGroup);

    // Current section ring
    if (isCurrent) {
      const ringGeometry = new THREE.TorusGeometry(size * 0.55, 0.06, 8, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: GLOW_COLOR,
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -size / 2 - 0.2;
      group.add(ring);
    }

    return group;
  };

  // Create visible graph inside cube
  const createGraphInside = (graphData, size) => {
    const graphGroup = new THREE.Group();
    const nodes = graphData.nodes;
    if (nodes.length === 0) return graphGroup;
    
    // Normalize positions
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    nodes.forEach(n => {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
    });
    
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeZ = maxZ - minZ || 1;
    const maxRange = Math.max(rangeX, rangeY, rangeZ);
    
    // Node spheres - visible size
    const nodePositions = [];
    const nodeSphereGeometry = new THREE.SphereGeometry(0.08, 8, 8);
    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: GRAPH_NODE_COLOR,
      transparent: true,
      opacity: 0.9,
    });

    nodes.forEach((node) => {
      const pos = new THREE.Vector3(
        ((node.x - minX) / maxRange - 0.5) * size,
        ((node.y - minY) / maxRange - 0.5) * size,
        ((node.z - minZ) / maxRange - 0.5) * size
      );
      nodePositions.push({ id: node.id, pos });
      
      const sphere = new THREE.Mesh(nodeSphereGeometry, nodeMaterial.clone());
      sphere.position.copy(pos);
      graphGroup.add(sphere);
    });

    // Edges
    if (graphData.links?.length > 0) {
      const nodeMap = new Map(nodePositions.map(n => [n.id, n.pos]));
      const edgePositions = [];

      graphData.links.slice(0, 60).forEach(link => {
        const sourceId = link.source ?? link.origen;
        const targetId = link.target ?? link.destino;
        const sourcePos = nodeMap.get(sourceId);
        const targetPos = nodeMap.get(targetId);
        
        if (sourcePos && targetPos) {
          edgePositions.push(sourcePos.x, sourcePos.y, sourcePos.z);
          edgePositions.push(targetPos.x, targetPos.y, targetPos.z);
        }
      });

      if (edgePositions.length > 0) {
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
        const edgeMaterial = new THREE.LineBasicMaterial({
          color: GRAPH_NODE_COLOR,
          transparent: true,
          opacity: 0.35,
        });
        const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        graphGroup.add(edgeLines);
      }
    }

    return graphGroup;
  };

  // Create connections between cubes
  const createConnections = (scene, positions) => {
    if (positions.length < 2) return;

    const connectionPositions = [];
    
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dist = positions[i].distanceTo(positions[j]);
        if (dist < 8) {
          connectionPositions.push(
            positions[i].x, positions[i].y, positions[i].z,
            positions[j].x, positions[j].y, positions[j].z
          );
        }
      }
    }

    if (connectionPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(connectionPositions, 3));
      const material = new THREE.LineBasicMaterial({
        color: EDGE_COLOR_INNER,
        transparent: true,
        opacity: 0.25,
      });
      const lines = new THREE.LineSegments(geometry, material);
      scene.add(lines);
    }
  };

  // Update HTML label positions
  const updateLabelsPosition = (camera, cubes, container) => {
    if (!camera || !container) return;
    
    const rect = container.getBoundingClientRect();
    
    cubes.forEach((cube, i) => {
      const labelEl = document.getElementById(`mv-label-${i}`);
      if (!labelEl) return;
      
      const pos = cube.position.clone();
      pos.y += 2.2;
      pos.project(camera);
      
      const x = (pos.x * 0.5 + 0.5) * rect.width;
      const y = (-pos.y * 0.5 + 0.5) * rect.height;
      
      if (pos.z < 1) {
        labelEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        labelEl.style.opacity = '1';
      } else {
        labelEl.style.opacity = '0';
      }
    });
  };

  // Handle cube click
  const handleCubeClick = useCallback((sectionName) => {
    if (focusedCube === sectionName) {
      if (onSelectSection) {
        onSelectSection(sectionName);
      }
    } else {
      setFocusedCube(sectionName);
      setHintText(`${sectionName.charAt(0).toUpperCase() + sectionName.slice(1)} · Click de nuevo para entrar`);
      
      const cube = cubeGroupsRef.current.find(c => c.userData.sectionName === sectionName);
      if (cube && controlsRef.current) {
        controlsRef.current.target.copy(cube.position);
        controlsRef.current.autoRotate = false;
      }
    }
  }, [focusedCube, onSelectSection]);

  return (
    <div className="mv-tesseract">
      <header className="mv-tesseract-header">
        <div className="mv-tesseract-title">
          <span className="mv-tesseract-icon">◈</span>
          <span>Multiverso</span>
          <span className="mv-tesseract-count">{sections.length} dimensiones</span>
        </div>
        <button className="mv-tesseract-close" onClick={onClose}>✕</button>
      </header>

      <div className="mv-tesseract-scene" ref={containerRef}>
        {loading && (
          <div className="mv-tesseract-loading">
            <div className="mv-tesseract-spinner" />
            <span>Construyendo Multiverso...</span>
          </div>
        )}
        
        {/* HTML Labels - outside Three.js to avoid bloom */}
        {!loading && labels.map((label, i) => (
          <div
            key={label.name}
            id={`mv-label-${i}`}
            className={`mv-tesseract-label ${label.isCurrent ? 'mv-tesseract-label--current' : ''}`}
          >
            <span className="mv-tesseract-label-name">{label.name}</span>
            <span className="mv-tesseract-label-count">{label.count} nodos</span>
          </div>
        ))}
      </div>

      <footer className="mv-tesseract-footer">
        <span>{hintText}</span>
      </footer>
    </div>
  );
}
