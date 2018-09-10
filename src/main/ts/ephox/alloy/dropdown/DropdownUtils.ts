import { Fun, Future, Merger, Option, Result } from '@ephox/katamari';
import { Width, Element } from '@ephox/sugar';

import * as ComponentStructure from '../alien/ComponentStructure';
import * as Behaviour from '../api/behaviour/Behaviour';
import { Composing } from '../api/behaviour/Composing';
import { Coupling } from '../api/behaviour/Coupling';
import { Focusing } from '../api/behaviour/Focusing';
import { Positioning } from '../api/behaviour/Positioning';
import { Sandboxing } from '../api/behaviour/Sandboxing';
import { AlloyComponent } from '../api/component/ComponentApi';
import { TieredData, tieredMenu as TieredMenu } from '../api/ui/TieredMenu';
import * as AriaOwner from '../aria/AriaOwner';
import * as InternalSink from '../parts/InternalSink';
import { HotspotAnchorSpec } from '../positioning/mode/Anchoring';
import * as Tagger from '../registry/Tagger';
import * as Dismissal from '../sandbox/Dismissal';
import { CommonDropdownDetail } from '../ui/types/DropdownTypes';
import { SketchBehaviours } from '../api/component/SketchBehaviours';

const getAnchor = (detail: CommonDropdownDetail<TieredData>, component: AlloyComponent): HotspotAnchorSpec => {
  const ourHotspot = detail.getHotspot()(component).getOr(component);
  return { anchor: 'hotspot', hotspot: ourHotspot };
};

const fetch = (detail: CommonDropdownDetail<TieredData>, mapFetch: (tdata: TieredData) => TieredData, component) => {
  const fetcher = detail.fetch();
  return fetcher(component).map(mapFetch);
};

const openF = (detail: CommonDropdownDetail<TieredData>, mapFetch: (tdata: TieredData) => TieredData, anchor: HotspotAnchorSpec, component, sandbox, externals) => {
  const futureData = fetch(detail, mapFetch, component);

  const lazySink = getSink(component, detail);

  // TODO: Make this potentially a single menu also
  return futureData.map((data) => {
    return TieredMenu.sketch(
      Merger.deepMerge(
        externals.menu(),
        {
          uid: Tagger.generate(''),
          data,

          onOpenMenu (tmenu, menu) {
            const sink = lazySink().getOrDie();
            Positioning.position(sink, anchor, menu);
            Sandboxing.decloak(sandbox);
          },

          onOpenSubmenu (tmenu, item, submenu) {
            const sink = lazySink().getOrDie();
            Positioning.position(sink, {
              anchor: 'submenu',
              item
            }, submenu);
            Sandboxing.decloak(sandbox);

          },
          onEscape () {
            // Focus the triggering component after escaping the menu
            Focusing.focus(component);
            Sandboxing.close(sandbox);
            return Option.some(true);
          }
        }
      )
    );
  });

};

// onOpenSync is because some operations need to be applied immediately, not wrapped in a future
// It can avoid things like flickering due to asynchronous bouncing
const open = (detail: CommonDropdownDetail<TieredData>, mapFetch: (tdata: TieredData) => TieredData, hotspot: AlloyComponent, sandbox: AlloyComponent, externals, onOpenSync) => {
  const anchor = getAnchor(detail, hotspot);
  const processed = openF(detail, mapFetch, anchor, hotspot, sandbox, externals);
  return processed.map((data) => {
    Sandboxing.cloak(sandbox);
    Sandboxing.open(sandbox, data);
    onOpenSync(sandbox);
    return sandbox;
  });
};

const close = (detail: CommonDropdownDetail<TieredData>, mapFetch: (tdata: TieredData) => TieredData, component, sandbox, _externals, _onOpenSync) => {
  Sandboxing.close(sandbox);
  return Future.pure(sandbox);
};

const togglePopup = (detail: CommonDropdownDetail<TieredData>, mapFetch: (tdata: TieredData) => TieredData, hotspot: AlloyComponent, externals, onOpenSync) => {
  const sandbox = Coupling.getCoupled(hotspot, 'sandbox');
  const showing = Sandboxing.isOpen(sandbox);

  const action = showing ? close : open;
  return action(detail, mapFetch, hotspot, sandbox, externals, onOpenSync);
};

const matchWidth = (hotspot: AlloyComponent, container: AlloyComponent) => {
  const menu = Composing.getCurrent(container).getOr(container);
  const buttonWidth = Width.get(hotspot.element());
  Width.set(menu.element(), buttonWidth);
};

interface SinkDetail {
  uid: () => string;
  lazySink: () => Option<() => Result<AlloyComponent, any>>;
}

const getSink = (anyInSystem: AlloyComponent, sinkDetail: SinkDetail) => {
  return anyInSystem.getSystem().getByUid(sinkDetail.uid() + '-' + InternalSink.suffix()).map((internalSink) => {
    return Fun.constant(
      Result.value(internalSink)
    );
  }).getOrThunk(() => {
    return sinkDetail.lazySink().fold(() => {
      return Fun.constant(
        Result.error(new Error(
          'No internal sink is specified, nor could an external sink be found'
        ))
      );
    }, Fun.identity);
  });
};

const makeSandbox = (detail: CommonDropdownDetail<TieredData>, hotspot: AlloyComponent, extras) => {
  const ariaOwner = AriaOwner.manager();

  const onOpen = (component, menu) => {
    const anchor = getAnchor(detail, hotspot);
    ariaOwner.link(hotspot.element());
    if (detail.matchWidth()) { matchWidth(anchor.hotspot, menu); }
    detail.onOpen()(anchor, component, menu);
    if (extras !== undefined && extras.onOpen !== undefined) { extras.onOpen(component, menu); }
  };

  const onClose = (component, menu) => {
    ariaOwner.unlink(hotspot.element());
    if (extras !== undefined && extras.onClose !== undefined) { extras.onClose(component, menu); }
  };

  const lazySink = getSink(hotspot, detail);

  return {
    dom: {
      tag: 'div',
      classes: detail.sandboxClasses(),
      attributes: {
        id: ariaOwner.id()
      }
    },
    behaviours: Merger.deepMerge(
      Behaviour.derive([
        Sandboxing.config({
          onOpen,
          onClose,
          isPartOf (container: AlloyComponent, data: AlloyComponent, queryElem: Element): boolean {
            return ComponentStructure.isPartOf(data, queryElem) || ComponentStructure.isPartOf(hotspot, queryElem);
          },
          getAttachPoint () {
            return lazySink().getOrDie();
          }
        }),
        Composing.config({
          find (sandbox: AlloyComponent): Option<AlloyComponent> {
            return Sandboxing.getState(sandbox).bind((menu) => {
              return Composing.getCurrent(menu);
            });
          }
        }),
        Dismissal.receivingConfig({
          isExtraPart: Fun.constant(false)
        })
      ]),
      SketchBehaviours.get(detail.sandboxBehaviours())
    )
  };
};

export {
  makeSandbox,
  togglePopup,
  open,

  getSink
};